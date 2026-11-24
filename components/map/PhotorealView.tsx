'use client';

import { useEffect, useRef } from 'react';
import { Deck, FlyToInterpolator, TerrainController, type MapViewState } from '@deck.gl/core';
import { GeoJsonLayer, IconLayer } from '@deck.gl/layers';
import { Tile3DLayer } from '@deck.gl/geo-layers';
import { _TerrainExtension as TerrainExtension, type TerrainExtensionProps } from '@deck.gl/extensions';
import type { FeatureCollection, Polygon } from 'geojson';
import type { Grade, SpotSummary } from '@/lib/contract/types';
import { GRADE_COLOR } from '@/lib/map/config';
import { gradeShapeSvg } from '@/lib/map/pins';

// 실사 3D 지도: Google Photorealistic 3D Tiles 위에 위험 구역을 표면에 덮고 포인트 핀을 세운다.
// Google 타일에 지형이 들어 있으므로 MapLibre 배경 지도·지형 타일은 쓰지 않는다.

const TILESET_URL = 'https://tile.googleapis.com/v1/3dtiles/root.json';

export interface PhotorealStats {
  /** 루트 타일셋을 받은 시각(ms, 페이지 시작 기준) */
  tilesetLoadedAt: number | null;
  /** 첫 타일이 그려질 준비가 된 시각(ms) */
  firstTileAt: number | null;
  tilesLoaded: number;
  tileErrors: number;
}

interface Props {
  apiKey: string;
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

export default function PhotorealView({ apiKey, view, spots, zones, grades, onCredits, onStats, onError }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const deckRef = useRef<Deck | null>(null);
  const stats = useRef<PhotorealStats>({ tilesetLoadedAt: null, firstTileAt: null, tilesLoaded: 0, tileErrors: 0 });
  // 콜백은 바뀌어도 Deck을 다시 만들지 않도록 ref로 들고 있는다.
  const callbacks = useRef({ onCredits, onStats, onError });
  useEffect(() => {
    callbacks.current = { onCredits, onStats, onError };
  });

  // Deck은 한 번만 만든다.
  useEffect(() => {
    if (!containerRef.current) return;
    const deck = new Deck({
      parent: containerRef.current,
      initialViewState: view,
      controller: { type: TerrainController, touchRotate: true, inertia: 250 },
      onError: (error) => callbacks.current.onError(error.message),
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
    const tiles = new Tile3DLayer({
      id: 'google-3d-tiles',
      data: TILESET_URL,
      loadOptions: { fetch: { headers: { 'X-GOOG-API-KEY': apiKey } } },
      // 구역과 핀이 이 표면을 지형으로 쓴다.
      operation: 'terrain+draw',
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

    deckRef.current?.setProps({ layers: [tiles, zoneLayer, pinLayer] });
  }, [apiKey, spots, zones, grades]);

  return <div ref={containerRef} className="photoreal" />;
}
