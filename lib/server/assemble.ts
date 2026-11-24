// DB 행 → API 응답. 네트워크·DB에 의존하지 않는 순수 함수라 단위 테스트한다.

import type {
  RiskAlert,
  SpotRiskResponse,
  SpotSummary,
  SpotsResponse,
} from '../contract/types';
import { computeHourlyRisk, isStale, type HourConditions, type SpotProfile, type TerrainInput } from '../risk';
import type { AlertRow, ForecastHourlyRow, SpotRow, TerrainScoreRow } from './db-types';

const HOUR_MS = 3_600_000;
export const PLACE_TZ = 'America/Los_Angeles';

export function floorHour(d: Date): string {
  return new Date(Math.floor(d.getTime() / HOUR_MS) * HOUR_MS).toISOString().replace('.000Z', 'Z');
}

export function addHours(iso: string, h: number): string {
  return new Date(Date.parse(iso) + h * HOUR_MS).toISOString().replace('.000Z', 'Z');
}

/** 현지 시각 "HH:MM" */
export function localClock(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: PLACE_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    new Date(iso),
  );
}

const seaLevel = (r: ForecastHourlyRow) => r.sea_level_corrected_m ?? r.sea_level_m;

/** time부터 13시간 안의 첫 만조(해수면 극대) 시각. 시간 단위 자료라 정시로 나온다. */
export function nextHighTide(series: ForecastHourlyRow[], time: string): string | null {
  const t = Date.parse(time);
  const s = series.filter((r) => seaLevel(r) !== null).sort((a, b) => a.time.localeCompare(b.time));
  for (let i = 1; i < s.length - 1; i++) {
    const ti = Date.parse(s[i].time);
    if (ti < t) continue;
    if (ti - t > 13 * HOUR_MS) break;
    const [a, b, c] = [seaLevel(s[i - 1])!, seaLevel(s[i])!, seaLevel(s[i + 1])!];
    if (b >= a && b > c) return s[i].time;
  }
  return null;
}

export function toConditions(time: string, row: ForecastHourlyRow | undefined, series: ForecastHourlyRow[]): HourConditions {
  const high = nextHighTide(series, time);
  return {
    time,
    waveHeightM: row?.wave_height_m ?? null,
    swellHeightM: row?.swell_height_m ?? null,
    swellPeriodS: row?.swell_period_s ?? null,
    windSpeedMs: row?.wind_speed_ms ?? null,
    windGustMs: row?.wind_gust_ms ?? null,
    precipitationMm: row?.precipitation_mm ?? null,
    weatherCode: row?.weather_code ?? null,
    seaLevelM: row ? seaLevel(row) : null,
    riverRatio: row?.river_ratio ?? null,
    apparentTempC: row?.apparent_temp_c ?? null,
    isDark: row?.is_dark ?? false,
    nextHighTideClock: high ? localClock(high) : null,
  };
}

export function toProfile(spot: SpotRow, t: TerrainScoreRow): SpotProfile {
  return {
    type: spot.type,
    // 고도를 모르면 위험한 쪽(0 m)으로 본다.
    elevationM: t.elevation_m ?? 0,
    egressMinElevationM: t.egress_min_elevation_m,
    slopeDeg: t.slope_deg ?? 0,
  };
}

export function toTerrainInput(t: TerrainScoreRow): TerrainInput {
  return {
    score: t.score,
    confidence: t.confidence,
    factors: t.factors.map(({ code, label, score }) => ({ code, label, score })),
  };
}

export function toRiskAlerts(rows: AlertRow[]): RiskAlert[] {
  return rows.map((a) => ({
    source: a.source,
    event: a.event,
    headline: a.headline ?? a.event,
    // 만료 시각이 없으면 1주일 뒤까지로 본다(다음 수집 때 목록에서 빠지면 지워진다).
    expires: a.expires ?? addHours(a.fetched_at, 24 * 7),
  }));
}

/** 경보 중 time에 이미 시작한 것만. onset이 미래인 경보는 그 시각부터 적용한다. */
function alertsAt(rows: AlertRow[], time: string): RiskAlert[] {
  return toRiskAlerts(rows.filter((a) => !a.onset || Date.parse(a.onset) <= Date.parse(time)));
}

const groupBy = <T, K>(xs: T[], key: (x: T) => K) => {
  const m = new Map<K, T[]>();
  for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return m;
};

export function buildSpots(
  time: string,
  spots: SpotRow[],
  terrains: TerrainScoreRow[],
  forecast: ForecastHourlyRow[],
  alerts: AlertRow[],
): SpotsResponse {
  const terrainBy = new Map(terrains.map((t) => [t.spot_id, t]));
  const seriesBy = groupBy(forecast, (r) => r.cell_id);
  const live = alertsAt(alerts, time);
  const out: SpotSummary[] = [];
  for (const s of spots) {
    const t = terrainBy.get(s.id);
    if (!t) continue; // 지형 분석 전 포인트는 내보내지 않는다
    const series = (s.forecast_cell_id && seriesBy.get(s.forecast_cell_id)) || [];
    const row = series.find((r) => r.time === time);
    const r = computeHourlyRisk(toConditions(time, row, series), toProfile(s, t), toTerrainInput(t), live);
    out.push({ id: s.id, name: s.name, type: s.type, lat: s.lat, lng: s.lng, score: r.score, grade: r.grade, confidence: r.confidence });
  }
  out.sort((a, b) => b.lat - a.lat);
  return { time, spots: out };
}

const WORST: Array<'low' | 'medium' | 'high'> = ['low', 'medium', 'high'];

export function buildSpotRisk(
  spot: SpotRow,
  terrain: TerrainScoreRow,
  series: ForecastHourlyRow[],
  alerts: AlertRow[],
  from: string,
  hours: number,
  now: Date,
): SpotRiskResponse | null {
  if (series.length === 0) return null;
  const rowBy = new Map(series.map((r) => [r.time, r]));
  const profile = toProfile(spot, terrain);
  const tin = toTerrainInput(terrain);

  const hourly = Array.from({ length: hours }, (_, i) => {
    const time = addHours(from, i);
    return computeHourlyRisk(toConditions(time, rowBy.get(time), series), profile, tin, alertsAt(alerts, time));
  });

  const fetchedAt = series.map((r) => r.fetched_at).sort()[0];
  const confidence = hourly.reduce<'low' | 'medium' | 'high'>(
    (c, h) => WORST[Math.min(WORST.indexOf(c), WORST.indexOf(h.confidence))],
    terrain.confidence,
  );
  const shownAlerts = toRiskAlerts(alerts).filter((a) => Date.parse(a.expires) > Date.parse(from));

  return {
    spot: {
      id: spot.id,
      name: spot.name,
      type: spot.type,
      lat: spot.lat,
      lng: spot.lng,
      access: { walkMinutes: spot.access_walk_minutes ?? 0, from: spot.access_from ?? '' },
    },
    terrain: {
      score: terrain.score,
      slopeDeg: Math.round(terrain.slope_deg ?? 0),
      elevationM: Math.round((terrain.elevation_m ?? 0) * 10) / 10,
      cover: terrain.cover ?? '',
      floodFrequency: terrain.flood_frequency ?? 'high',
      factors: tin.factors,
    },
    hourly: hourly.map(({ time, score, grade, causes }) => ({ time, score, grade, causes })),
    alerts: shownAlerts,
    forecastFetchedAt: new Date(fetchedAt).toISOString().replace('.000Z', 'Z'),
    stale: isStale(fetchedAt, now.toISOString()),
    confidence,
  };
}
