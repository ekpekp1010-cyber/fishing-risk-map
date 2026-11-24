import type { Grade } from '@/lib/ui/api-types';

// 시범 지역: 미국 오리건주 뉴포트 해안. 값은 대략적인 범위다.
export const PILOT = {
  name: '오리건주 뉴포트',
  center: [-124.062, 44.632] as [number, number],
  /** [서, 남, 동, 북] */
  bbox: [-124.1, 44.59, -124.02, 44.69] as [number, number, number, number],
  zoom: 12.3,
};

const env = (v: string | undefined) => (v && v.length > 0 ? v : null);

const terrainUrl = env(process.env.NEXT_PUBLIC_TERRAIN_TILES_URL);

export const MAP_CONFIG = {
  /** 배경 지도 스타일. 기본값은 OpenStreetMap 기반 공개 스타일이다. */
  styleUrl: env(process.env.NEXT_PUBLIC_BASEMAP_STYLE_URL) ?? 'https://tiles.openfreemap.org/styles/positron',
  /** 지형 타일. 개발자 A의 terrain-RGB 타일이 나오기 전에는 공개 지형 타일을 쓴다. */
  terrainTiles: terrainUrl ?? 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  terrainEncoding: (terrainUrl ? 'mapbox' : 'terrarium') as 'mapbox' | 'terrarium',
  terrainMaxZoom: terrainUrl ? 14 : 13,
  /** 개발자 A가 올리는 위험 구역 PMTiles. 없으면 임시 구역 도형을 쓴다. */
  zonesPmtilesUrl: env(process.env.NEXT_PUBLIC_ZONES_PMTILES_URL),
  /** 아래 두 레이어는 타일 주소가 있을 때만 켤 수 있다. */
  satelliteTiles: env(process.env.NEXT_PUBLIC_SATELLITE_TILES_URL),
  floodTiles: env(process.env.NEXT_PUBLIC_FLOOD_TILES_URL),
};

// 지도 위의 구역과 핀 색. 배경 지도는 화면 테마와 무관하게 항상 밝으므로, 밝은 테마의 등급 색으로 고정한다.
// styles/tokens.css의 밝은 테마 등급 색과 같은 값이며, 흰 글자와의 대비가 4.5:1 이상이다.
export const GRADE_COLOR: Record<Grade, string> = {
  safe: '#2E7D32',
  caution: '#9A5B00',
  danger: '#B3261E',
};

export function inPilotBbox(lng: number, lat: number): boolean {
  const [w, s, e, n] = PILOT.bbox;
  return lng >= w && lng <= e && lat >= s && lat <= n;
}

export interface LayerState {
  zones: boolean;
  relief: boolean;
  flood: boolean;
  satellite: boolean;
}

export const DEFAULT_LAYERS: LayerState = { zones: true, relief: false, flood: false, satellite: false };
