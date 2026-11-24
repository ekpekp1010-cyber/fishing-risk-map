import type { NextRequest } from 'next/server';
import { addHours, buildSpots } from '@/lib/server/assemble';
import { AOI, intersectsAoi } from '@/lib/server/coverage';
import { listAlerts, listForecast, listSpotsInBox, listTerrain } from '@/lib/server/db';
import { ApiError, handle, parseBbox, parseTime, untilNextHour } from '@/lib/server/http';

// GET /api/spots?bbox=<서>,<남>,<동>,<북>&time=<시각>
export async function GET(request: NextRequest) {
  return handle(async () => {
    const q = request.nextUrl.searchParams;
    const box = parseBbox(q.get('bbox')) ?? AOI;
    const time = parseTime(q.get('time'));
    if (!intersectsAoi(box)) throw new ApiError('OUT_OF_COVERAGE', '이 지역은 아직 분석되지 않았다.');

    const spots = await listSpotsInBox(box);
    const cellIds = [...new Set(spots.map((s) => s.forecast_cell_id).filter((x): x is string => !!x))];
    // 만조 시각 문장을 위해 13시간 뒤까지 읽는다.
    const [terrains, forecast, alerts] = await Promise.all([
      listTerrain(spots.map((s) => s.id)),
      listForecast(cellIds, addHours(time, -1), addHours(time, 14)),
      listAlerts(time),
    ]);
    return Response.json(buildSpots(time, spots, terrains, forecast, alerts), { headers: untilNextHour() });
  });
}
