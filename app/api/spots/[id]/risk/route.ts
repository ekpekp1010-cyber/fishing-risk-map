import type { NextRequest } from 'next/server';
import { addHours, buildSpotRisk } from '@/lib/server/assemble';
import { getSpot, listAlerts, listForecast, listTerrain } from '@/lib/server/db';
import { ApiError, handle, parseIntIn, parseTime, untilNextHour } from '@/lib/server/http';

// GET /api/spots/{id}/risk?from=<시각>&hours=<1~72>
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const q = request.nextUrl.searchParams;
    const from = parseTime(q.get('from'));
    const hours = parseIntIn(q.get('hours'), 'hours', 1, 72, 72);

    const spot = await getSpot(id);
    if (!spot) throw new ApiError('NOT_FOUND', `포인트를 찾지 못했다: ${id}`);
    const [terrain] = await listTerrain([spot.id]);
    if (!terrain) throw new ApiError('NOT_FOUND', `아직 지형 분석이 없는 포인트다: ${id}`);

    const cell = spot.forecast_cell_id ? [spot.forecast_cell_id] : [];
    const [series, alerts] = await Promise.all([
      listForecast(cell, addHours(from, -1), addHours(from, hours + 13)),
      listAlerts(from),
    ]);
    const body = buildSpotRisk(spot, terrain, series, alerts, from, hours, new Date());
    if (!body) throw new ApiError('FORECAST_UNAVAILABLE', '이 시간대의 예보를 아직 수집하지 못했다.');
    return Response.json(body, { headers: untilNextHour() });
  });
}
