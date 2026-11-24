// Open-Meteo Forecast·Marine·Flood를 예보 격자 셀 단위로 불러 forecast_hourly 행으로 바꾼다.
// 여러 셀을 한 번에 요청한다(위도·경도를 쉼표로 나열하면 배열로 돌아온다).

import type { ForecastCellRow, ForecastHourlyRow } from './db-types';

const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const FLOOD_URL = 'https://flood-api.open-meteo.com/v1/flood';

export const FORECAST_DAYS = 4; // 72시간 + 여유

const MARINE_VARS = [
  'wave_height',
  'wave_direction',
  'wave_period',
  'swell_wave_height',
  'swell_wave_period',
  'swell_wave_direction',
  'sea_level_height_msl',
] as const;

const FORECAST_VARS = [
  'wind_speed_10m',
  'wind_gusts_10m',
  'wind_direction_10m',
  'precipitation',
  'weather_code',
  'apparent_temperature',
  'is_day',
] as const;

type Series = { time: string[]; [key: string]: unknown };

/** 시계열에서 i번째 숫자. 없거나 숫자가 아니면 null */
function num(s: Series, key: string, i: number): number | null {
  const a = s[key];
  return Array.isArray(a) && typeof a[i] === 'number' ? (a[i] as number) : null;
}
interface HourlyPayload {
  hourly?: Series;
}
interface DailyPayload {
  daily?: Series;
}

const toArray = <T,>(x: T | T[]): T[] => (Array.isArray(x) ? x : [x]);

/** Open-Meteo의 "2026-11-24T00:00"(UTC) → "2026-11-24T00:00:00Z" */
export function toIsoUtc(t: string): string {
  return t.length === 16 ? `${t}:00Z` : t.endsWith('Z') ? t : `${t}Z`;
}

function cellQuery(cells: ForecastCellRow[]) {
  return {
    latitude: cells.map((c) => c.lat.toFixed(2)).join(','),
    longitude: cells.map((c) => c.lng.toFixed(2)).join(','),
  };
}

async function getJson<T>(url: string, params: Record<string, string>, fetcher: typeof fetch): Promise<T | T[]> {
  const u = `${url}?${new URLSearchParams(params)}`;
  const res = await fetcher(u, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}: ${u}`);
  return (await res.json()) as T | T[];
}

function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** 일 단위 유량 → 날짜별 (유량, 최근 30일 중앙값 대비 비) */
export function riverByDay(daily: Series | undefined, today: string): Map<string, { discharge: number | null; ratio: number | null }> {
  const out = new Map<string, { discharge: number | null; ratio: number | null }>();
  if (!daily) return out;
  const past = daily.time.map((d, i) => (d < today ? num(daily, 'river_discharge', i) : null)).filter((x): x is number => x !== null);
  const base = median(past);
  daily.time.forEach((d, i) => {
    const v = num(daily, 'river_discharge', i);
    out.set(d, { discharge: v, ratio: v !== null && base ? v / base : null });
  });
  return out;
}

/** 한 셀의 세 응답을 시간별 행으로 합친다. 순수 함수. */
export function mergeCell(
  cellId: string,
  marine: HourlyPayload | undefined,
  forecast: HourlyPayload | undefined,
  flood: DailyPayload | undefined,
  fetchedAt: string,
): ForecastHourlyRow[] {
  const rows = new Map<string, ForecastHourlyRow>();
  const row = (time: string): ForecastHourlyRow => {
    let r = rows.get(time);
    if (!r) {
      r = {
        cell_id: cellId,
        time,
        wave_height_m: null,
        wave_period_s: null,
        wave_direction_deg: null,
        swell_height_m: null,
        swell_period_s: null,
        swell_direction_deg: null,
        wind_speed_ms: null,
        wind_gust_ms: null,
        wind_direction_deg: null,
        precipitation_mm: null,
        weather_code: null,
        sea_level_m: null,
        sea_level_corrected_m: null,
        river_discharge_m3s: null,
        river_ratio: null,
        apparent_temp_c: null,
        is_dark: null,
        raw: null,
        fetched_at: fetchedAt,
      };
      rows.set(time, r);
    }
    return r;
  };

  const m = marine?.hourly;
  m?.time.forEach((t, i) => {
    const r = row(toIsoUtc(t));
    r.wave_height_m = num(m, 'wave_height', i);
    r.wave_direction_deg = num(m, 'wave_direction', i);
    r.wave_period_s = num(m, 'wave_period', i);
    r.swell_height_m = num(m, 'swell_wave_height', i);
    r.swell_period_s = num(m, 'swell_wave_period', i);
    r.swell_direction_deg = num(m, 'swell_wave_direction', i);
    r.sea_level_m = num(m, 'sea_level_height_msl', i);
  });

  const f = forecast?.hourly;
  f?.time.forEach((t, i) => {
    const r = row(toIsoUtc(t));
    r.wind_speed_ms = num(f, 'wind_speed_10m', i);
    r.wind_gust_ms = num(f, 'wind_gusts_10m', i);
    r.wind_direction_deg = num(f, 'wind_direction_10m', i);
    r.precipitation_mm = num(f, 'precipitation', i);
    r.weather_code = num(f, 'weather_code', i);
    r.apparent_temp_c = num(f, 'apparent_temperature', i);
    const isDay = num(f, 'is_day', i);
    r.is_dark = isDay === null ? null : isDay === 0;
  });

  const river = riverByDay(flood?.daily, fetchedAt.slice(0, 10));
  for (const r of rows.values()) {
    const d = river.get(r.time.slice(0, 10));
    if (d) {
      r.river_discharge_m3s = d.discharge;
      r.river_ratio = d.ratio;
    }
  }

  return [...rows.values()].sort((a, b) => a.time.localeCompare(b.time));
}

/** 셀 목록의 예보를 불러 행으로 만든다. 한 API가 실패해도 나머지로 행을 만든다. */
export async function fetchForecastRows(
  cells: ForecastCellRow[],
  now: Date = new Date(),
  fetcher: typeof fetch = fetch,
): Promise<{ rows: ForecastHourlyRow[]; errors: string[] }> {
  if (cells.length === 0) return { rows: [], errors: [] };
  const q = cellQuery(cells);
  const common = { ...q, timezone: 'UTC', forecast_days: String(FORECAST_DAYS) };
  const errors: string[] = [];
  const settle = async <T,>(p: Promise<T | T[]>): Promise<T[] | undefined> => {
    try {
      return toArray(await p);
    } catch (e) {
      errors.push((e as Error).message);
      return undefined;
    }
  };

  const [marine, forecast, flood] = await Promise.all([
    settle(getJson<HourlyPayload>(MARINE_URL, { ...common, hourly: MARINE_VARS.join(',') }, fetcher)),
    settle(
      getJson<HourlyPayload>(
        FORECAST_URL,
        { ...common, hourly: FORECAST_VARS.join(','), wind_speed_unit: 'ms' },
        fetcher,
      ),
    ),
    settle(
      getJson<DailyPayload>(
        FLOOD_URL,
        { ...q, daily: 'river_discharge', past_days: '30', forecast_days: String(FORECAST_DAYS) },
        fetcher,
      ),
    ),
  ]);

  const fetchedAt = now.toISOString();
  const rows = cells.flatMap((c, i) => mergeCell(c.id, marine?.[i], forecast?.[i], flood?.[i], fetchedAt));
  return { rows, errors };
}
