// 분석된 지역. pipeline/fishrisk/config.py의 AOI와 같은 값이다.

export const AOI = { west: -124.1, south: 44.59, east: -124.02, north: 44.69 } as const;

/** 시범 지역 대표 지점(NWS 경보 조회용): NOAA 9435380 South Beach */
export const AOI_POINT = { lat: 44.625, lng: -124.045 } as const;

type Box = { west: number; south: number; east: number; north: number };

export function intersectsAoi(b: Box): boolean {
  return b.west <= AOI.east && b.east >= AOI.west && b.south <= AOI.north && b.north >= AOI.south;
}

/** 분석 지역에서 가장 가까운 점(지역 안이면 그 점 그대로) */
export function nearestAoiPoint(p: { lat: number; lng: number }): { lat: number; lng: number } {
  return {
    lat: Math.min(AOI.north, Math.max(AOI.south, p.lat)),
    lng: Math.min(AOI.east, Math.max(AOI.west, p.lng)),
  };
}

/** 중심과 반경(km)을 덮는 위경도 상자 */
export function boxAround(p: { lat: number; lng: number }, radiusKm: number): Box {
  const dLat = radiusKm / 111.32;
  const dLng = radiusKm / (111.32 * Math.max(0.01, Math.cos((p.lat * Math.PI) / 180)));
  return { west: p.lng - dLng, south: p.lat - dLat, east: p.lng + dLng, north: p.lat + dLat };
}
