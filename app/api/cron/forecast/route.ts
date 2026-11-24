import type { NextRequest } from 'next/server';
import { AOI_POINT } from '@/lib/server/coverage';
import { listCells, replaceAlerts, upsertForecast } from '@/lib/server/db';
import { requireEnv } from '@/lib/server/env';
import { handle } from '@/lib/server/http';
import { applyCorrection, computeSurge, fetchStation } from '@/lib/server/noaa';
import { fetchActiveAlerts } from '@/lib/server/nws';
import { fetchForecastRows } from '@/lib/server/open-meteo';

export const maxDuration = 60;

// 수동 수집용. 정기 수집은 Supabase pg_cron이 한다(supabase/migrations/*_forecast_collector.sql).
// Authorization: Bearer <CRON_SECRET>
export async function GET(request: NextRequest) {
  return handle(async () => {
    if (request.headers.get('authorization') !== `Bearer ${requireEnv('CRON_SECRET')}`) {
      return new Response('Unauthorized', { status: 401 });
    }
    const now = new Date();
    const cells = await listCells();
    const { rows: raw, errors } = await fetchForecastRows(cells, now);
    let rows = raw;
    let tide: string;
    try {
      const station = await fetchStation(now);
      const surge = computeSurge(station, now);
      rows = applyCorrection(raw, station, surge);
      tide = surge ? `해일 성분 ${surge.surgeM.toFixed(2)} m (${surge.at})` : '관측 지연, 보정 안 함';
    } catch (e) {
      tide = `NOAA 실패: ${(e as Error).message}`;
    }
    const saved = await upsertForecast(rows);

    let alerts: number | string;
    try {
      const a = await fetchActiveAlerts(AOI_POINT, requireEnv('NWS_USER_AGENT'), now);
      await replaceAlerts(a);
      alerts = a.length;
    } catch (e) {
      // 경보 조회 실패 때는 이전 경보를 지우지 않고 둔다(위험한 쪽).
      alerts = `실패: ${(e as Error).message}`;
    }

    return Response.json(
      { fetchedAt: now.toISOString(), cells: cells.length, rows: saved, tide, alerts, errors },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  });
}
