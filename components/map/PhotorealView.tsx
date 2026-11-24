'use client';

import { useEffect, useRef, useState } from 'react';
import { Deck, FlyToInterpolator, TerrainController, type MapViewState } from '@deck.gl/core';
import { GeoJsonLayer, IconLayer } from '@deck.gl/layers';
import { TerrainLayer, Tile3DLayer } from '@deck.gl/geo-layers';
import { _TerrainExtension as TerrainExtension, type TerrainExtensionProps } from '@deck.gl/extensions';
import type { FeatureCollection, Polygon } from 'geojson';
import type { Grade, SpotSummary } from '@/lib/contract/types';
import { GRADE_COLOR, MAP_CONFIG } from '@/lib/map/config';
import { gradeShapeSvg } from '@/lib/map/pins';

// 실사 3D 지도: Google Photorealistic 3D Tiles 위에 위험 구역을 표면에 덮고 포인트 핀을 세운다.
//
// 점진 교체(docs/redesign-plan.md 4.5):
// 1. 처음에는 가벼운 지도(공개 지형 + 항공 사진의 TerrainLayer)를 그리고 구역·핀을 그 위에 얹는다.
// 2. 실사 레이어는 처음부터 투명하게 그려 타일을 미리 받는다. deck.gl은 그려지는 레이어만
//    카메라를 받아 타일을 고르므로 visible: false로 숨기면 타일을 받지 않는다.
// 3. 지금 보이는 범위의 실사 타일이 다 오면 실사를 보이게 하고 지형 역할도 넘긴다. 되돌리지 않는다.

const TILESET_URL = 'https://tile.googleapis.com/v1/3dtiles/root.json';

/** 공개 지형 타일의 높이 해석 방식 */
const ELEVATION_DECODER = {
  terrarium: { rScaler: 256, gScaler: 1, bScaler: 1 / 256, offset: -32768 },
  mapbox: { rScaler: 6553.6, gScaler: 25.6, bScaler: 0.1, offset: -10000 },
};

export type PhotorealPhase = 'light' | 'photoreal';

export interface PhotorealStats {
  phase: PhotorealPhase;
  /** 가벼운 지도의 첫 타일이 온 시각(ms, 페이지 시작 기준) */
  lightReadyAt: number | null;
  /** 루트 타일셋을 받은 시각(ms) */
  tilesetLoadedAt: number | null;
  /** 첫 실사 타일이 온 시각(ms) */
  firstTileAt: number | null;
  /** 실사로 바뀐 시각(ms) */
  switchedAt: number | null;
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

export default function PhotorealView({ apiKey, photoreal, view, spots, zones, grades, onCredits, onStats, onError }: Props) {
  // Deck이 캔버스를 직접 만들게 하면, 개발 모드에서 효과가 두 번 실행될 때 첫 캔버스가 남아 지도를 밀어낸다.
  // 그래서 캔버스는 이 컴포넌트가 그리고 Deck은 거기에 그리기만 한다.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const deckRef = useRef<Deck | null>(null);
  const stats = useRef<PhotorealStats>({
    phase: 'light',
    lightReadyAt: null,
    tilesetLoadedAt: null,
    firstTileAt: null,
    switchedAt: null,
    tilesLoaded: 0,
    tileErrors: 0,
  });
  const [phase, setPhase] = useState<PhotorealPhase>('light');
  /** 실사 타일셋. 매 프레임 다 받았는지 확인하는 데 쓴다. */
  const tilesetRef = useRef<{ isLoaded: () => boolean } | null>(null);
  // 콜백은 바뀌어도 Deck을 다시 만들지 않도록 ref로 들고 있는다.
  const callbacks = useRef({ onCredits, onStats, onError });
  useEffect(() => {
    callbacks.current = { onCredits, onStats, onError };
  });

  // Deck은 한 번만 만든다.
  useEffect(() => {
    if (!canvasRef.current) return;
    const deck = new Deck({
      canvas: canvasRef.current,
      initialViewState: view,
      controller: { type: TerrainController, touchRotate: true, inertia: 250 },
      onError: (error) => callbacks.current.onError(error.message),
      // 지금 보이는 범위의 실사 타일을 다 받았으면 실사로 바꾼다.
      onAfterRender: () => {
        const s = stats.current;
        if (s.phase === 'light' && s.tilesLoaded > 0 && tilesetRef.current?.isLoaded()) {
          s.phase = 'photoreal';
          s.switchedAt = Math.round(performance.now());
          performance.mark('photoreal-switch');
          setPhase('photoreal');
          callbacks.current.onStats({ ...s });
        }
      },
      getTooltip: ({ object }) => (object && 'name' in object ? `${object.name} · 점수 ${object.score}` : null),
    });
    deckRef.current = deck;
    return () => {
      deck.finalize();
      deckRef.current = null;
    };
    // 처음 카메라만 쓰고, 이후 이동은 아래 효과가 맡는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 카메라 이동(포인트로 날아가기)
  useEffect(() => {
    deckRef.current?.setProps({
      initialViewState: { ...view, transitionDuration: 1800, transitionInterpolator: new FlyToInterpolator() },
    });
  }, [view]);

  // 레이어
  useEffect(() => {
    const report = () => callbacks.current.onStats({ ...stats.current });
    const isPhotoreal = phase === 'photoreal';

    // 가벼운 지도: 실사로 바뀌기 전까지 보이고, 구역·핀이 얹히는 지형이 된다.
    const light = new TerrainLayer({
      id: 'light-terrain',
      elevationData: MAP_CONFIG.terrainTiles,
      elevationDecoder: ELEVATION_DECODER[MAP_CONFIG.terrainEncoding],
      texture: MAP_CONFIG.satelliteTiles,
      maxZoom: Math.min(MAP_CONFIG.terrainMaxZoom, MAP_CONFIG.satelliteMaxZoom),
      visible: !isPhotoreal,
      operation: 'terrain+draw',
      // TerrainController가 화면 가운데의 지형 높이를 깊이 피킹으로 읽는다.
      pickable: !isPhotoreal,
      onTileLoad: () => {
        if (stats.current.lightReadyAt === null) {
          stats.current.lightReadyAt = Math.round(performance.now());
          performance.mark('light-first-tile');
          report();
        }
      },
    });

    const tiles = new Tile3DLayer({
      id: 'google-3d-tiles',
      data: TILESET_URL,
      visible: photoreal,
      loadOptions: { fetch: { headers: { 'X-GOOG-API-KEY': apiKey } } },
      // 바뀌기 전: 투명하게 그려 타일만 받는다. 깊이를 기록하지 않아 가벼운 지도를 가리지 않는다.
      // 바뀐 뒤: 구역과 핀이 이 표면을 지형으로 쓴다.
      operation: isPhotoreal ? 'terrain+draw' : 'draw',
      opacity: isPhotoreal ? 1 : 0,
      parameters: isPhotoreal ? {} : { depthWriteEnabled: false },
      pickable: isPhotoreal ? '3d' : false,
      onTilesetLoad: (tileset) => {
        tilesetRef.current = tileset;
        stats.current.tilesetLoadedAt ??= Math.round(performance.now());
        report();
        // Google 정책: 화면에 보이는 타일의 저작권 문구를 모아 표시한다.
        tileset.options.onTraversalComplete = (selected) => {
          const credits = new Set<string>();
          for (const tile of selected) {
            const copyright: string | undefined = tile.content?.gltf?.asset?.copyright;
            copyright?.split(';').forEach((c) => c.trim() && credits.add(c.trim()));
          }
          // 실사가 보이기 전에는 Google 출처를 띄우지 않는다.
          if (stats.current.phase === 'photoreal') callbacks.current.onCredits([...credits].join('; '));
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
      getSize: PIN_SIZE,
      getPosition: (s) => [s.lng, s.lat],
      getIcon: (s) => pinIcon(s.grade),
      updateTriggers: { getIcon: spots.map((s) => s.grade).join() },
      extensions: [new TerrainExtension()],
      terrainDrawMode: 'offset',
      // 핀이 건물이나 절벽에 가려지지 않게 한다.
      parameters: { depthCompare: 'always' },
    });

    deckRef.current?.setProps({ layers: [light, tiles, zoneLayer, pinLayer] });
  }, [apiKey, photoreal, phase, spots, zones, grades]);

  return (
    <div className="photoreal">
      <canvas ref={canvasRef} className="photoreal__canvas" />
    </div>
  );
}
