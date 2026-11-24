// Supabase 접근. service role 키를 쓰므로 Route Handler·배치에서만 쓴다.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AlertRow, ForecastCellRow, ForecastHourlyRow, SpotRow, TerrainScoreRow, ZoneRow } from './db-types';
import { requireEnv } from './env';

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  client ??= createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

function check<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(`Supabase: ${r.error.message}`);
  return r.data as T;
}

/** Postgres timestamptz("2026-11-24 08:00:00+00" 또는 "...+00:00") → "2026-11-24T08:00:00Z". 코드 전체가 이 형식으로 비교한다. */
export function isoZ<T extends string | null>(v: T): T {
  if (v === null) return v;
  const t = Date.parse(v);
  return (Number.isNaN(t) ? v : new Date(t).toISOString().replace('.000Z', 'Z')) as T;
}

const SPOT_COLS = 'id,name,type,lat,lng,access_walk_minutes,access_from,forecast_cell_id,active';
const TERRAIN_COLS =
  'spot_id,score,slope_deg,elevation_m,cover,flood_frequency,egress_min_elevation_m,factors,confidence';

export async function listCells(): Promise<ForecastCellRow[]> {
  return check(await db().from('forecast_cells').select('id,lat,lng').order('id'));
}

export async function listSpotsInBox(box: { west: number; south: number; east: number; north: number }): Promise<SpotRow[]> {
  return check(
    await db()
      .from('spots')
      .select(SPOT_COLS)
      .eq('active', true)
      .gte('lat', box.south)
      .lte('lat', box.north)
      .gte('lng', box.west)
      .lte('lng', box.east),
  );
}

export async function listZones(): Promise<ZoneRow[]> {
  return check(await db().from('zones').select('id,spot_id,forecast_cell_id,terrain_score').order('id'));
}

export async function getSpot(id: string): Promise<SpotRow | null> {
  return check(await db().from('spots').select(SPOT_COLS).eq('id', id).eq('active', true).maybeSingle());
}

export async function listTerrain(spotIds: string[]): Promise<TerrainScoreRow[]> {
  if (spotIds.length === 0) return [];
  return check(await db().from('terrain_scores').select(TERRAIN_COLS).in('spot_id', spotIds));
}

/** 셀들의 [from, to) 시간 범위 예보 */
export async function listForecast(cellIds: string[], from: string, to: string): Promise<ForecastHourlyRow[]> {
  if (cellIds.length === 0) return [];
  const rows: ForecastHourlyRow[] = check(
    await db()
      .from('forecast_hourly')
      .select('*')
      .in('cell_id', cellIds)
      .gte('time', from)
      .lt('time', to)
      .order('time'),
  );
  return rows.map((r) => ({ ...r, time: isoZ(r.time), fetched_at: isoZ(r.fetched_at) }));
}

/** from 시각 이후에도 유효한 경보(만료 시각이 없으면 계속 유효로 본다) */
export async function listAlerts(from: string): Promise<AlertRow[]> {
  const rows: AlertRow[] = check(await db().from('alerts').select('*').or(`expires.is.null,expires.gt.${from}`));
  return rows.map((a) => ({ ...a, onset: isoZ(a.onset), expires: isoZ(a.expires), fetched_at: isoZ(a.fetched_at) }));
}

export async function upsertForecast(rows: ForecastHourlyRow[]): Promise<number> {
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    check(await db().from('forecast_hourly').upsert(rows.slice(i, i + CHUNK), { onConflict: 'cell_id,time' }));
  }
  return rows.length;
}

/** 이번에 받은 경보로 교체한다: 받은 것은 upsert, 목록에서 사라진 것은 지운다. */
export async function replaceAlerts(rows: AlertRow[]): Promise<void> {
  if (rows.length > 0) check(await db().from('alerts').upsert(rows, { onConflict: 'id' }));
  const keep = rows.map((r) => r.id);
  const del = db().from('alerts').delete().eq('source', 'NWS');
  check(await (keep.length > 0 ? del.not('id', 'in', `(${keep.map((k) => `"${k}"`).join(',')})`) : del));
}
