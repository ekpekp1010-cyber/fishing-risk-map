// NOAA CO-OPS 9435380 South Beach로 해수면 예보를 보정한다.
//
// Open-Meteo 해수면은 만조·간조 시각이 어긋나 관측소 실측과 RMSE 약 0.3 m 차이가 났다(2026-11-24, 72시간).
// 그래서 관측소의 천문조 예측(predicted)에 지금의 해일 성분(실측 - 천문조, 최근 3시간 평균)을 더하고,
// 해일 성분은 시간이 지날수록 exp(-Δt/48h)로 줄어든다고 본다. 같은 72시간 시험에서
// 1·6·12·24시간 뒤 오차가 0.03·0.06·0.10·0.15 m였다.
// 관측이 3시간 넘게 끊기면 보정하지 않는다(Open-Meteo 값을 그대로 쓴다).
// supabase/migrations/*_tide_correction.sql 의 SQL 구현과 같은 규칙이다.

import type { ForecastHourlyRow } from './db-types';

export const NOAA_STATION = '9435380';
const BASE = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';

export const SURGE_DECAY_HOURS = 48;
export const SURGE_WINDOW_HOURS = 3;
export const MAX_OBS_AGE_HOURS = 3;

const HOUR = 3_600_000;

export interface StationHour {
  time: string; // ISO Z, 정시
  predicted: number | null;
  observed: number | null;
}

/** NOAA "2026-11-24 09:00"(GMT) → "2026-11-24T09:00:00Z" */
export function noaaTime(t: string): string {
  return `${t.replace(' ', 'T')}:00Z`;
}

/** 6분 간격 실측과 시간별 천문조 → 정시 행. 실측은 정각 값만 쓴다. */
export function mergeStation(
  observed: Array<{ t: string; v: string }>,
  predicted: Array<{ t: string; v: string }>,
): StationHour[] {
  const by = new Map<string, StationHour>();
  const row = (time: string) => {
    let r = by.get(time);
    if (!r) by.set(time, (r = { time, predicted: null, observed: null }));
    return r;
  };
  for (const p of predicted) if (p.v !== '') row(noaaTime(p.t)).predicted = Number(p.v);
  for (const o of observed) if (o.t.endsWith(':00') && o.v !== '') row(noaaTime(o.t)).observed = Number(o.v);
  return [...by.values()].sort((a, b) => a.time.localeCompare(b.time));
}

export interface Surge {
  surgeM: number;
  /** 해일 성분을 잰 마지막 실측 시각 */
  at: string;
  hours: number;
}

/** 최근 실측 3시간의 (실측 - 천문조) 평균. 관측이 오래됐거나 짝이 없으면 null. */
export function computeSurge(rows: StationHour[], now: Date): Surge | null {
  const pairs = rows.filter((r) => r.observed !== null && r.predicted !== null);
  if (pairs.length === 0) return null;
  const last = pairs[pairs.length - 1];
  if (now.getTime() - Date.parse(last.time) > MAX_OBS_AGE_HOURS * HOUR) return null;
  const from = Date.parse(last.time) - (SURGE_WINDOW_HOURS - 1) * HOUR;
  const win = pairs.filter((r) => Date.parse(r.time) >= from);
  const surgeM = win.reduce((s, r) => s + (r.observed! - r.predicted!), 0) / win.length;
  return { surgeM, at: last.time, hours: win.length };
}

/** 한 시각의 보정 해수면. 실측이 있으면 실측, 없으면 천문조 + 줄어드는 해일 성분. */
export function correctedLevel(row: StationHour | undefined, surge: Surge): number | null {
  if (!row) return null;
  if (row.observed !== null) return row.observed;
  if (row.predicted === null) return null;
  const lead = Math.max(0, (Date.parse(row.time) - Date.parse(surge.at)) / HOUR);
  return row.predicted + surge.surgeM * Math.exp(-lead / SURGE_DECAY_HOURS);
}

/** 예보 행에 sea_level_corrected_m을 채운다. 보정할 수 없으면 null(=Open-Meteo 값 사용). */
export function applyCorrection(rows: ForecastHourlyRow[], station: StationHour[], surge: Surge | null): ForecastHourlyRow[] {
  const by = new Map(station.map((s) => [s.time, s]));
  return rows.map((r) => ({
    ...r,
    sea_level_corrected_m: surge ? correctedLevel(by.get(r.time), surge) : null,
  }));
}

function noaaDate(d: Date): string {
  return d.toISOString().slice(0, 10).replaceAll('-', '');
}

export async function fetchStation(now: Date = new Date(), fetcher: typeof fetch = fetch): Promise<StationHour[]> {
  const common = `station=${NOAA_STATION}&datum=MSL&units=metric&time_zone=gmt&format=json&application=fishing-risk-map`;
  const begin = noaaDate(new Date(now.getTime() - 24 * HOUR));
  const [obs, pred] = await Promise.all([
    fetcher(`${BASE}?${common}&product=water_level&range=24`, { cache: 'no-store' }).then((r) => r.json()),
    fetcher(`${BASE}?${common}&product=predictions&interval=h&begin_date=${begin}&range=144`, { cache: 'no-store' }).then((r) =>
      r.json(),
    ),
  ]);
  if (obs.error && pred.error) throw new Error(`NOAA: ${obs.error.message}`);
  return mergeStation(obs.data ?? [], pred.predictions ?? []);
}
