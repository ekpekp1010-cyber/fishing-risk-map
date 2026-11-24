import type { NextRequest } from 'next/server';
import { RECOMMEND } from '@/lib/risk';
import { addHours, buildRecommendations, distanceKm, scoreSpotsAt } from '@/lib/server/assemble';
import { boxAround, nearestAoiPoint } from '@/lib/server/coverage';
import { getSpot, listAlerts, listForecast, listSpotsInBox, listTerrain } from '@/lib/server/db';
import { ApiError, handle, parseNumberIn, parseTime, untilNextHour } from '@/lib/server/http';

// GET /api/recommendations?lat=<위도>&lng=<경도>&time=<시각>&radiusKm=<기본 30>&excludeSpotId=<선택>
export async function GET(request: NextRequest) {
  return handle(async () => {
    const q = request.nextUrl.searchParams;
    const origin = { lat: parseNumberIn(q.get('lat'), 'lat', -90, 90), lng: parseNumberIn(q.get('lng'), 'lng', -180, 180) };
    const radiusKm = parseNumberIn(q.get('radiusKm'), 'radiusKm', 0.1, 200, RECOMMEND.defaultRadiusKm);
    const time = parseTime(q.get('time'));
    const excludeSpotId = q.get('excludeSpotId') || null;

    if (distanceKm(origin, nearestAoiPoint(origin)) > radiusKm) {
      throw new ApiError('OUT_OF_COVERAGE', '이 지역은 아직 분석되지 않았다.');
    }

    const spots = await listSpotsInBox(boxAround(origin, radiusKm));
    // 비교 기준 포인트가 반경 밖에 있어도 점수는 알아야 한다.
    if (excludeSpotId && !spots.some((s) => s.id === excludeSpotId)) {
      const base = await getSpot(excludeSpotId);
      if (!base) throw new ApiError('NOT_FOUND', `포인트를 찾지 못했다: ${excludeSpotId}`);
      spots.push(base);
    }
    const cellIds = [...new Set(spots.map((s) => s.forecast_cell_id).filter((x): x is string => !!x))];
    const [terrains, forecast, alerts] = await Promise.all([
      listTerrain(spots.map((s) => s.id)),
      listForecast(cellIds, addHours(time, -1), addHours(time, 14)),
      listAlerts(time),
    ]);
    const scored = scoreSpotsAt(time, spots, terrains, forecast, alerts);
    return Response.json(buildRecommendations(time, origin, radiusKm, scored, excludeSpotId), { headers: untilNextHour() });
  });
}
