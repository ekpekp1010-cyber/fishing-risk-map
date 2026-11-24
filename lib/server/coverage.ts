// 분석된 지역. pipeline/fishrisk/config.py의 AOI와 같은 값이다.

export const AOI = { west: -124.1, south: 44.59, east: -124.02, north: 44.69 } as const;

/** 시범 지역 대표 지점(NWS 경보 조회용): NOAA 9435380 South Beach */
export const AOI_POINT = { lat: 44.625, lng: -124.045 } as const;

type Box = { west: number; south: number; east: number; north: number };

export function intersectsAoi(b: Box): boolean {
  return b.west <= AOI.east && b.east >= AOI.west && b.south <= AOI.north && b.north >= AOI.south;
}
