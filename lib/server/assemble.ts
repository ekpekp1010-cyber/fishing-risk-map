// DB 행 → API 응답. 네트워크·DB에 의존하지 않는 순수 함수라 단위 테스트한다.

import type {
  Grade,
  RecommendationItem,
  RecommendationsResponse,
  RiskAlert,
  SpotRiskResponse,
  SpotSummary,
  SpotsResponse,
  SpotType,
  ZoneGradesResponse,
} from '../contract/types';
import {
  computeHourlyRisk,
  isStale,
  RECOMMEND,
  type HourConditions,
  type RiskDetail,
  type SpotProfile,
  type TerrainInput,
} from '../risk';
import type { AlertRow, ForecastHourlyRow, SpotRow, TerrainScoreRow, ZoneRow } from './db-types';

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
    waveExposure: waveExposureOf(t),
  };
}

/** 지형 요인 wave_exposure 점수(0~100)를 0~1로. 없으면 1(위험한 쪽). */
export function waveExposureOf(t: TerrainScoreRow): number {
  const f = t.factors.find((x) => x.code === 'wave_exposure');
  return f ? f.score / 100 : 1;
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

export interface ScoredSpot {
  spot: SpotRow;
  terrain: TerrainScoreRow;
  risk: RiskDetail;
}

/** 한 시각에 포인트들의 위험도를 계산한다. 지형 분석 전 포인트는 뺀다. */
export function scoreSpotsAt(
  time: string,
  spots: SpotRow[],
  terrains: TerrainScoreRow[],
  forecast: ForecastHourlyRow[],
  alerts: AlertRow[],
): ScoredSpot[] {
  const terrainBy = new Map(terrains.map((t) => [t.spot_id, t]));
  const seriesBy = groupBy(forecast, (r) => r.cell_id);
  const live = alertsAt(alerts, time);
  const out: ScoredSpot[] = [];
  for (const spot of spots) {
    const terrain = terrainBy.get(spot.id);
    if (!terrain) continue;
    const series = (spot.forecast_cell_id && seriesBy.get(spot.forecast_cell_id)) || [];
    const row = series.find((r) => r.time === time);
    const risk = computeHourlyRisk(toConditions(time, row, series), toProfile(spot, terrain), toTerrainInput(terrain), live);
    out.push({ spot, terrain, risk });
  }
  return out;
}

export function buildSpots(
  time: string,
  spots: SpotRow[],
  terrains: TerrainScoreRow[],
  forecast: ForecastHourlyRow[],
  alerts: AlertRow[],
): SpotsResponse {
  const out: SpotSummary[] = scoreSpotsAt(time, spots, terrains, forecast, alerts).map(({ spot: s, risk: r }) => ({
    id: s.id,
    name: s.name,
    type: s.type,
    lat: s.lat,
    lng: s.lng,
    score: r.score,
    grade: r.grade,
    confidence: r.confidence,
  }));
  out.sort((a, b) => b.lat - a.lat);
  // 그 시각에 시작했고 아직 끝나지 않은 경보
  const live = alertsAt(alerts, time).filter((a) => Date.parse(a.expires) > Date.parse(time));
  return { time, spots: out, alerts: live };
}

// ---- 3. 구역 등급 ------------------------------------------------------------

/**
 * 포인트가 있는 구역은 그 포인트의 등급을 쓴다.
 * 포인트가 없는 구역은 구역의 지형 점수와 예보 셀로 계산하되, 고도를 몰라 위험한 쪽으로 본다
 * (고도 0 m, 신뢰도 낮음). 지형 점수도 없으면 내보내지 않는다.
 */
export function buildZoneGrades(
  time: string,
  zones: ZoneRow[],
  scored: ScoredSpot[],
  forecast: ForecastHourlyRow[],
  alerts: AlertRow[],
): ZoneGradesResponse {
  const bySpot = new Map(scored.map((s) => [s.spot.id, s.risk.grade]));
  const seriesBy = groupBy(forecast, (r) => r.cell_id);
  const live = alertsAt(alerts, time);
  const grades: Record<string, Grade> = {};
  for (const z of zones) {
    const g = z.spot_id ? bySpot.get(z.spot_id) : undefined;
    if (g) {
      grades[z.id] = g;
      continue;
    }
    if (z.terrain_score === null) continue;
    const series = (z.forecast_cell_id && seriesBy.get(z.forecast_cell_id)) || [];
    const row = series.find((r) => r.time === time);
    const profile: SpotProfile = { type: 'beach', elevationM: 0, egressMinElevationM: null, slopeDeg: 0 };
    const terrain: TerrainInput = { score: z.terrain_score, confidence: 'low', factors: [] };
    grades[z.id] = computeHourlyRisk(toConditions(time, row, series), profile, terrain, live).grade;
  }
  return { time, grades };
}

// ---- 4. 추천 ----------------------------------------------------------------

const TYPE_KO: Record<SpotType, string> = {
  jetty: '방파제',
  pier: '부두',
  rocks: '갯바위',
  beach: '해변',
  estuary: '하구',
};

/** 추천 이유 한 줄. 예: "파랑이 가려지는 부두, 베이프런트 주차장에서 3분" */
export function recommendReason(s: ScoredSpot): string {
  const exposure = s.terrain.factors.find((f) => f.code === 'wave_exposure');
  const sheltered = exposure !== undefined && exposure.score <= RECOMMEND.shelteredMaxExposure;
  const place = `${sheltered ? '파랑이 가려지는 ' : ''}${TYPE_KO[s.spot.type]}`;
  const walk = s.spot.access_walk_minutes;
  const access = walk === null ? '' : s.spot.access_from ? `, ${s.spot.access_from}에서 ${walk}분` : `, 도보 ${walk}분`;
  const caution = s.risk.grade === 'caution' && s.risk.causes[0] ? ` (주의: ${s.risk.causes[0].label})` : '';
  return `${place}${access}${caution}`;
}

export function rankKey(s: ScoredSpot): number {
  return s.risk.score + RECOMMEND.walkPointsPerMinute * (s.spot.access_walk_minutes ?? RECOMMEND.unknownWalkMinutes);
}

/**
 * 같은 시각 기준 danger를 빼고 점수+도보 시간으로 정렬해 최대 5곳.
 * excludeSpotId가 있으면 그 포인트보다 점수가 낮은 곳만(PRD F4 수용 기준).
 */
export function buildRecommendations(
  time: string,
  origin: { lat: number; lng: number },
  radiusKm: number,
  scored: ScoredSpot[],
  excludeSpotId: string | null,
): RecommendationsResponse {
  const base = excludeSpotId ? scored.find((s) => s.spot.id === excludeSpotId) : undefined;
  const limit = base ? base.risk.score : Number.POSITIVE_INFINITY;
  const items: RecommendationItem[] = scored
    .filter((s) => s.spot.id !== excludeSpotId)
    .filter((s) => distanceKm(origin, s.spot) <= radiusKm)
    .filter((s) => !s.risk.noForecast) // 예보 없는 포인트는 추천하지 않는다
    .filter((s) => s.risk.grade !== 'danger' && s.risk.score < limit)
    .sort((a, b) => rankKey(a) - rankKey(b) || a.risk.score - b.risk.score)
    .slice(0, RECOMMEND.maxItems)
    .map((s) => ({
      id: s.spot.id,
      name: s.spot.name,
      type: s.spot.type,
      lat: s.spot.lat,
      lng: s.spot.lng,
      score: s.risk.score,
      grade: s.risk.grade as Exclude<Grade, 'danger'>,
      walkMinutes: s.spot.access_walk_minutes ?? 0,
      reason: recommendReason(s),
    }));
  return { time, items };
}

/** 두 지점 사이 거리(km, 구면 근사) */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
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
