import type { NextRequest } from 'next/server';
import { addHours, buildZoneGrades, scoreSpotsAt } from '@/lib/server/assemble';
import { AOI } from '@/lib/server/coverage';
import { listAlerts, listForecast, listSpotsInBox, listTerrain, listZones } from '@/lib/server/db';
import { handle, parseTime, untilNextHour } from '@/lib/server/http';

// GET /api/zones/grades?time=<시각>
export async function GET(request: NextRequest) {
  return handle(async () => {
    const time = parseTime(request.nextUrl.searchParams.get('time'));
    const [zones, spots] = await Promise.all([listZones(), listSpotsInBox(AOI)]);
    const cellIds = [
      ...new Set([...spots.map((s) => s.forecast_cell_id), ...zones.map((z) => z.forecast_cell_id)].filter((x): x is string => !!x)),
    ];
    const [terrains, forecast, alerts] = await Promise.all([
      listTerrain(spots.map((s) => s.id)),
      listForecast(cellIds, addHours(time, -1), addHours(time, 14)),
      listAlerts(time),
    ]);
    const scored = scoreSpotsAt(time, spots, terrains, forecast, alerts);
    return Response.json(buildZoneGrades(time, zones, scored, forecast, alerts), { headers: untilNextHour() });
  });
}
