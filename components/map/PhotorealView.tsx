'use client';

import { useEffect, useRef, useState } from 'react';
import { Deck, FlyToInterpolator, TerrainController, type MapViewState } from '@deck.gl/core';
import { GeoJsonLayer, IconLayer, ScatterplotLayer } from '@deck.gl/layers';
import { TerrainLayer, Tile3DLayer } from '@deck.gl/geo-layers';
import { _TerrainExtension as TerrainExtension, type TerrainExtensionProps } from '@deck.gl/extensions';
import type { FeatureCollection, Polygon } from 'geojson';
import type { Grade, SpotSummary } from '@/lib/contract/types';
import { GRADE_COLOR, MAP_CONFIG } from '@/lib/map/config';
import { gradeShapeSvg } from '@/lib/map/pins';

// 실사 3D 지도: Google Photorealistic 3D Tiles 위에 위험 구역을 표면에 덮고 포인트 핀을 세운다.
//
// 실사를 처음부터 그린다(docs/redesign-plan.md 4.5, D3). 실사는 거친 타일부터 받아 점점 선명해지므로
// 따로 교체할 필요가 없다. 가벼운 지도(공개 지형 + 항공 사진)는 실사를 쓸 수 없을 때만 대신 그린다.

const TILESET_URL = 'https://tile.googleapis.com/v1/3dtiles/root.json';

/** 이 시간 안에 실사 타일이 하나도 오지 않으면 가벼운 지도로 대신한다. */
const PHOTOREAL_TIMEOUT_MS = 12_000;

/** 공개 지형 타일의 높이 해석 방식 */
const ELEVATION_DECODER = {
  terrarium: { rScaler: 256, gScaler: 1, bScaler: 1 / 256, offset: -32768 },
  mapbox: { rScaler: 6553.6, gScaler: 25.6, bScaler: 0.1, offset: -10000 },
};

export type MapMode = 'photoreal' | 'light';
/** 가벼운 지도로 대신한 이유 */
export type FallbackReason = 'off' | 'error' | 'timeout';

export interface PhotorealStats {
  mode: MapMode;
  fallbackReason: FallbackReason | null;
  /** 루트 타일셋을 받은 시각(ms, 페이지 시작 기준) */
  tilesetLoadedAt: number | null;
  /** 첫 실사 타일이 온 시각(ms) */
  firstTileAt: number | null;
  /** 가벼운 지도의 첫 타일이 온 시각(ms). 가벼운 지도를 쓸 때만 */
  lightReadyAt: number | null;
  tilesLoaded: number;
  tileErrors: number;
}

interface Props {
  apiKey: string;
  /** false면 실사 타일을 받지 않고 가벼운 지도만 쓴다(데이터 절약 등). */
  photoreal: boolean;
  view: MapViewState;
  spots: SpotSummary[];
  zones: FeatureCollection<Polygon>;
  grades: Record<string, Grade>;
  onCredits: (credits: string) => void;
  onStats: (stats: PhotorealStats) => void;
  onError: (message: string) => void;
  /** 핀을 눌렀을 때 */
  onSelect?: (spotId: string) => void;
  /** 고른 핀은 크게 그린다 */
  selectedId?: string | null;
  /** 사용자가 지도를 움직일 때마다 카메라 위치를 알린다(2D·3D를 바꿔도 같은 곳을 보게) */
  onViewChange?: (view: MapViewState) => void;
  /** 내 위치(파란 점). 없으면 그리지 않는다 */
  userLocation?: { lng: number; lat: number } | null;
}

const rgba = (hex: string, alpha: number): [number, number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
  alpha,
];

const PIN_SIZE = 40;
const pinIcon = (grade: Grade) => ({
  id: grade,
  url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(gradeShapeSvg(grade, PIN_SIZE * 2))}`,
  width: PIN_SIZE * 2,
  height: PIN_SIZE * 2,
});

export default function PhotorealView({
  apiKey,
  photoreal,
  view,
  spots,
  zones,
  grades,
  onCredits,
  onStats,
  onError,
  onSelect,
  selectedId = null,
  onViewChange,
  userLocation = null,
}: Props) {
  // Deck이 캔버스를 직접 만들게 하면, 개발 모드에서 효과가 두 번 실행될 때 첫 캔버스가 남아 지도를 밀어낸다.
  // 그래서 캔버스는 이 컴포넌트가 그리고 Deck은 거기에 그리기만 한다.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const deckRef = useRef<Deck | null>(null);
  const [fallback, setFallback] = useState<FallbackReason | null>(photoreal ? null : 'off');
  const mode: MapMode = fallback ? 'light' : 'photoreal';
  const stats = useRef<PhotorealStats>({
    mode,
    fallbackReason: fallback,
    tilesetLoadedAt: null,
    firstTileAt: null,
    lightReadyAt: null,
    tilesLoaded: 0,
    tileErrors: 0,
  });
  // 콜백은 바뀌어도 Deck을 다시 만들지 않도록 ref로 들고 있는다.
  const callbacks = useRef({ onCredits, onStats, onError, onSelect, onViewChange });
  useEffect(() => {
    callbacks.current = { onCredits, onStats, onError, onSelect, onViewChange };
  });

  const report = () => callbacks.current.onStats({ ...stats.current });
  const fallBack = (reason: FallbackReason) => {
    if (stats.current.fallbackReason) return;
    stats.current.mode = 'light';
    stats.current.fallbackReason = reason;
    callbacks.current.onCredits('');
    setFallback(reason);
    report();
  };

  // Deck은 한 번만 만든다.
  useEffect(() => {
    if (!canvasRef.current) return;
    const deck = new Deck({
      canvas: canvasRef.current,
      initialViewState: view,
      controller: { type: TerrainController, touchRotate: true, inertia: 250 },
      onError: (error, layer) => {
        // 실사 타일셋을 못 받으면(키 오류, 한도 초과 등) 가벼운 지도로 대신한다.
        if (layer?.id === 'google-3d-tiles') fallBack('error');
        callbacks.current.onError(error.message);
      },
      getTooltip: ({ object }) => (object && 'name' in object ? object.name : null),
      onClick: ({ layer, object }) => {
        if (layer?.id === 'spot-pins' && object) callbacks.current.onSelect?.((object as SpotSummary).id);
      },
      getCursor: ({ isHovering, isDragging }) => (isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'),
      onViewStateChange: ({ viewState }) => {
        callbacks.current.onViewChange?.(viewState as MapViewState);
      },
    });
    deckRef.current = deck;
    return () => {
      deck.finalize();
      deckRef.current = null;
    };
    // 처음 카메라만 쓰고, 이후 이동은 아래 효과가 맡는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 실사 타일이 제때 오지 않으면 가벼운 지도로 대신한다.
  // 개발 서버는 코드를 처음 요청받을 때 컴파일하느라 타일 요청이 20초 넘게 늦을 수 있어 시간 초과를 쓰지 않는다.
  useEffect(() => {
    if (fallback || process.env.NODE_ENV === 'development') return;
    const timer = setTimeout(() => {
      if (stats.current.firstTileAt === null) fallBack('timeout');
    }, PHOTOREAL_TIMEOUT_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fallback]);

  // 카메라 이동(포인트로 날아가기)
  useEffect(() => {
    deckRef.current?.setProps({
      initialViewState: { ...view, transitionDuration: 1800, transitionInterpolator: new FlyToInterpolator() },
    });
  }, [view]);

  // 레이어
  useEffect(() => {
    const base =
      mode === 'photoreal'
        ? new Tile3DLayer({
            id: 'google-3d-tiles',
            data: TILESET_URL,
            loadOptions: { fetch: { headers: { 'X-GOOG-API-KEY': apiKey } } },
            // 구역과 핀이 이 표면을 지형으로 쓴다.
            operation: 'terrain+draw',
            // TerrainController가 화면 가운데의 지형 높이를 깊이 피킹으로 읽는다.
            pickable: '3d',
            onTilesetLoad: (tileset) => {
              stats.current.tilesetLoadedAt ??= Math.round(performance.now());
              report();
              // Google 정책: 화면에 보이는 타일의 저작권 문구를 모아 표시한다.
              tileset.options.onTraversalComplete = (selected) => {
                const credits = new Set<string>();
                for (const tile of selected) {
                  const copyright: string | undefined = tile.content?.gltf?.asset?.copyright;
                  copyright?.split(';').forEach((c) => c.trim() && credits.add(c.trim()));
                }
                callbacks.current.onCredits([...credits].join('; '));
                return selected;
              };
            },
            onTileLoad: () => {
              stats.current.tilesLoaded += 1;
              if (stats.current.firstTileAt === null) {
                stats.current.firstTileAt = Math.round(performance.now());
                performance.mark('photoreal-first-tile');
              }
              report();
            },
            onTileError: () => {
              stats.current.tileErrors += 1;
              report();
            },
          })
        : new TerrainLayer({
            id: 'light-terrain',
            elevationData: MAP_CONFIG.terrainTiles,
            elevationDecoder: ELEVATION_DECODER[MAP_CONFIG.terrainEncoding],
            texture: MAP_CONFIG.satelliteTiles,
            maxZoom: Math.min(MAP_CONFIG.terrainMaxZoom, MAP_CONFIG.satelliteMaxZoom),
            operation: 'terrain+draw',
            pickable: true,
            onTileLoad: () => {
              if (stats.current.lightReadyAt === null) {
                stats.current.lightReadyAt = Math.round(performance.now());
                performance.mark('light-first-tile');
                report();
              }
            },
          });

    const zoneLayer = new GeoJsonLayer<Record<string, unknown>, TerrainExtensionProps>({
      id: 'risk-zones',
      data: zones,
      stroked: false,
      filled: true,
      getFillColor: (f) => rgba(GRADE_COLOR[grades[String(f.properties?.zoneId)] ?? 'safe'], 110),
      updateTriggers: { getFillColor: grades },
      extensions: [new TerrainExtension()],
      terrainDrawMode: 'drape',
    });

    const pinLayer = new IconLayer<SpotSummary, TerrainExtensionProps>({
      id: 'spot-pins',
      data: spots,
      pickable: true,
      billboard: true,
      sizeScale: 1,
      getSize: (s) => (s.id === selectedId ? PIN_SIZE * 1.5 : PIN_SIZE),
      getPosition: (s) => [s.lng, s.lat],
      getIcon: (s) => pinIcon(s.grade),
      updateTriggers: { getIcon: spots.map((s) => s.grade).join(), getSize: selectedId },
      extensions: [new TerrainExtension()],
      terrainDrawMode: 'offset',
      // 핀이 건물이나 절벽에 가려지지 않게 한다.
      parameters: { depthCompare: 'always' },
    });

    // 내 위치: 흰 테두리의 파란 점. 지형 높이에 맞춰 얹는다.
    const userLayer = new ScatterplotLayer<{ lng: number; lat: number }, TerrainExtensionProps>({
      id: 'user-location',
      data: userLocation ? [userLocation] : [],
      getPosition: (d) => [d.lng, d.lat],
      radiusUnits: 'pixels',
      getRadius: 9,
      getFillColor: [26, 109, 255, 255],
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 3,
      getLineColor: [255, 255, 255, 255],
      billboard: true,
      extensions: [new TerrainExtension()],
      terrainDrawMode: 'offset',
      parameters: { depthCompare: 'always' },
    });

    deckRef.current?.setProps({ layers: [base, zoneLayer, userLayer, pinLayer] });
  }, [apiKey, mode, spots, zones, grades, selectedId, userLocation]);

  return (
    <div className="photoreal">
      <canvas ref={canvasRef} className="photoreal__canvas" />
    </div>
  );
}
