// 화면 개발용 데이터 공급원. 개발자 A의 실제 API가 준비되기 전까지 쓴다.
//
// 등급 계산은 A의 위험도 모델(lib/risk)을 그대로 쓰고, 날씨는 실제 값을 넣는다.
//   - 72시간 예보: Open-Meteo(바람, 돌풍, 강수, 파고, 너울, 해수면)
//   - 공식 경보: 미국 기상청(NWS)의 발효 중 경보
// 그래서 구역·핀의 등급이 지도의 실시간 파고·바람 레이어와 같은 데이터를 본다.
// 실제 예보를 못 받으면 가상의 날씨로 대신한다(이때는 실시간 레이어와 어긋날 수 있다).
//
// 아직 예시인 것: 포인트의 좌표, 이름, 지형 점수. 실제 분석 결과가 아니다.
// 실제 API가 연결되면 이 파일은 지운다.

import type { FeatureCollection, Polygon } from 'geojson';
import type {
  Confidence,
  FloodFrequency,
  Grade,
  RecommendationsResponse,
  RiskAlert,
  SpotRiskResponse,
  SpotSummary,
  SpotsResponse,
  SpotType,
  TerrainFactor,
  ZoneGradesResponse,
} from '@/lib/contract/types';
import { computeHourlyRisk, type HourConditions, type SpotProfile, type TerrainInput } from '@/lib/risk';
import { addHoursIso, formatClock, placeHour } from './time';

interface SpotDef {
  id: string;
  name: string;
  type: SpotType;
  lat: number;
  lng: number;
  /** 지형 취약성 V (0~100) */
  terrain: number;
  /** 외해로 열려 있는가 (지형 요약 문장용) */
  open: boolean;
  elevationM: number;
  slopeDeg: number;
  cover: string;
  flood: FloodFrequency;
  walkMinutes: number;
  from: string;
  reason: string;
}

const SPOTS: SpotDef[] = [
  { id: 'south-jetty-tip', name: '사우스 제티 끝', type: 'jetty', lat: 44.6124, lng: -124.0802, terrain: 78, open: true, elevationM: 3, slopeDeg: 26, cover: '암반', flood: 'high', walkMinutes: 22, from: '사우스 제티 주차장', reason: '방파제 끝, 너울이 약할 때만 권장' },
  { id: 'south-jetty-mid', name: '사우스 제티 중간', type: 'jetty', lat: 44.6131, lng: -124.0712, terrain: 64, open: true, elevationM: 3, slopeDeg: 24, cover: '암반', flood: 'high', walkMinutes: 12, from: '사우스 제티 주차장', reason: '방파제 중간, 주차장에서 12분' },
  { id: 'north-jetty-mid', name: '노스 제티 중간', type: 'jetty', lat: 44.6168, lng: -124.0745, terrain: 66, open: true, elevationM: 3, slopeDeg: 25, cover: '암반', flood: 'high', walkMinutes: 15, from: '노스 제티 진입로', reason: '방파제 중간, 진입로에서 15분' },
  { id: 'nye-rocks', name: '나이 비치 남쪽 암반', type: 'rocks', lat: 44.6362, lng: -124.0652, terrain: 70, open: true, elevationM: 2, slopeDeg: 21, cover: '암반', flood: 'high', walkMinutes: 9, from: '나이 비치 주차장', reason: '암반 해안, 간조 때만 접근' },
  { id: 'nye-beach', name: '나이 비치', type: 'beach', lat: 44.6408, lng: -124.0638, terrain: 38, open: true, elevationM: 4, slopeDeg: 4, cover: '모래', flood: 'medium', walkMinutes: 4, from: '나이 비치 주차장', reason: '완만한 모래 해변, 주차장에서 4분' },
  { id: 'agate-beach', name: '아게이트 비치', type: 'beach', lat: 44.6638, lng: -124.0608, terrain: 42, open: true, elevationM: 4, slopeDeg: 5, cover: '모래', flood: 'medium', walkMinutes: 7, from: '아게이트 비치 주차장', reason: '넓은 모래 해변, 주차장에서 7분' },
  { id: 'south-beach', name: '사우스 비치', type: 'beach', lat: 44.6022, lng: -124.0682, terrain: 36, open: true, elevationM: 5, slopeDeg: 4, cover: '모래', flood: 'low', walkMinutes: 8, from: '사우스 비치 주립공원 주차장', reason: '퇴로가 넓은 모래 해변, 주차장에서 8분' },
  { id: 'bay-st-pier', name: '베이 스트리트 부두', type: 'pier', lat: 44.6302, lng: -124.0521, terrain: 18, open: false, elevationM: 6, slopeDeg: 1, cover: '인공 구조물', flood: 'low', walkMinutes: 3, from: '베이프런트 주차장', reason: '파랑이 가려지는 만 안쪽, 주차장에서 3분' },
  { id: 'abbey-st-pier', name: '애비 스트리트 부두', type: 'pier', lat: 44.6312, lng: -124.0561, terrain: 20, open: false, elevationM: 6, slopeDeg: 1, cover: '인공 구조물', flood: 'low', walkMinutes: 2, from: '베이프런트 주차장', reason: '난간이 있는 만 안쪽 부두, 주차장에서 2분' },
  { id: 'south-beach-pier', name: '사우스 비치 공용 부두', type: 'pier', lat: 44.6236, lng: -124.0498, terrain: 22, open: false, elevationM: 5, slopeDeg: 1, cover: '인공 구조물', flood: 'low', walkMinutes: 4, from: '사우스 비치 마리나 주차장', reason: '만 안쪽 공용 부두, 주차장에서 4분' },
  { id: 'idaho-flat', name: '아이다호 플랫 하구', type: 'estuary', lat: 44.6189, lng: -124.0421, terrain: 46, open: false, elevationM: 1, slopeDeg: 1, cover: '갯벌', flood: 'high', walkMinutes: 6, from: '해트필드 해양과학센터 주차장', reason: '파랑은 약하지만 밀물에 잠기는 갯벌' },
];

const HOUR_MS = 3_600_000;
const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));

// ---- 포인트의 고정 정보를 위험도 모델의 입력으로 바꾸기 ----------------------

const terrainConfidence = (s: SpotDef): Confidence => (s.elevationM <= 2 ? 'low' : s.type === 'pier' ? 'high' : 'medium');

const terrainFactors = (s: SpotDef): TerrainFactor[] => [
  { code: 'slope', label: `경사 ${s.slopeDeg}°`, score: clamp(s.slopeDeg * 3.2) },
  { code: 'low_elevation', label: `평균해면보다 ${s.elevationM} m 높음`, score: clamp(100 - s.elevationM * 16) },
  { code: 'exposure', label: s.open ? '외해로 열린 방향' : '만 안쪽, 파랑이 가려짐', score: s.open ? 85 : 20 },
];

const profileOf = (s: SpotDef): SpotProfile => ({
  type: s.type,
  elevationM: s.elevationM,
  egressMinElevationM: null,
  slopeDeg: s.slopeDeg,
});

const terrainOf = (s: SpotDef): TerrainInput => ({
  score: s.terrain,
  confidence: terrainConfidence(s),
  factors: terrainFactors(s),
});

// ---- 실제 예보와 경보 ---------------------------------------------------------

/** 시범 지역 앞바다의 한 지점. 좁은 구간이라 모든 포인트가 같은 예보를 쓴다. */
const FORECAST_POINT = { lat: 44.62, lng: -124.1 };

let realByHour: Map<string, HourConditions> | null = null;
let realAlerts: RiskAlert[] = [];
let realFetchedAt: string | null = null;
let loading: Promise<void> | null = null;

/** 낚시 안전과 관련 있는 경보만 쓰고, 화면용 한국어 이름을 붙인다. */
const ALERT_NAMES: Array<[RegExp, string]> = [
  [/Tsunami/i, '지진해일 경보'],
  [/Storm Surge/i, '폭풍 해일 경보'],
  [/High Surf/i, '높은 파도 주의보'],
  [/Coastal Flood/i, '해안 침수 주의보'],
  [/Beach Hazards/i, '해변 위험 안내'],
  [/Gale|High Wind|Wind Advisory/i, '강풍 특보'],
  [/Thunderstorm/i, '뇌우 경보'],
  [/Flood/i, '홍수 특보'],
];

type Hourly = { time: string[] } & Record<string, Array<number | null>>;

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

async function fetchReal(): Promise<void> {
  const at = `latitude=${FORECAST_POINT.lat}&longitude=${FORECAST_POINT.lng}`;
  const span = 'timezone=GMT&past_hours=1&forecast_hours=74';
  const [weather, marine, alerts] = await Promise.all([
    getJson<{ hourly: Hourly }>(
      `https://api.open-meteo.com/v1/forecast?${at}&hourly=wind_speed_10m,wind_gusts_10m,precipitation,weather_code,apparent_temperature,is_day&wind_speed_unit=ms&${span}`,
    ),
    getJson<{ hourly: Hourly }>(
      `https://marine-api.open-meteo.com/v1/marine?${at}&hourly=wave_height,swell_wave_height,swell_wave_period,sea_level_height_msl&${span}`,
    ),
    getJson<{ features: Array<{ properties: { event: string; ends: string | null; expires: string } }> }>(
      'https://api.weather.gov/alerts/active?point=44.63,-124.06',
    ),
  ]);
  if (!weather?.hourly?.time) return;

  const w = weather.hourly;
  const m = marine?.hourly;
  const sea = m?.sea_level_height_msl ?? [];
  const byHour = new Map<string, HourConditions>();
  w.time.forEach((t, i) => {
    const time = `${t}:00Z`;
    // 앞으로 13시간 안에서 해수면이 가장 높은 시각을 다음 만조로 본다.
    let peak = i;
    for (let j = i; j < Math.min(i + 14, sea.length); j++) if ((sea[j] ?? -Infinity) > (sea[peak] ?? -Infinity)) peak = j;
    byHour.set(time, {
      time,
      waveHeightM: m?.wave_height?.[i] ?? null,
      swellHeightM: m?.swell_wave_height?.[i] ?? null,
      swellPeriodS: m?.swell_wave_period?.[i] ?? null,
      windSpeedMs: w.wind_speed_10m?.[i] ?? null,
      windGustMs: w.wind_gusts_10m?.[i] ?? null,
      precipitationMm: w.precipitation?.[i] ?? null,
      weatherCode: w.weather_code?.[i] ?? null,
      seaLevelM: sea[i] ?? null,
      riverRatio: null,
      apparentTempC: w.apparent_temperature?.[i] ?? null,
      isDark: w.is_day?.[i] === 0,
      nextHighTideClock: sea.length > 0 && w.time[peak] ? formatClock(`${w.time[peak]}:00Z`) : null,
    });
  });

  // 같은 종류의 경보가 기간을 나눠 여러 건 오면 하나로 묶고, 가장 늦은 종료 시각을 쓴다.
  const merged = new Map<string, RiskAlert>();
  for (const { properties: p } of alerts?.features ?? []) {
    const name = ALERT_NAMES.find(([re]) => re.test(p.event))?.[1];
    if (!name) continue;
    const expires = new Date(p.ends ?? p.expires).toISOString();
    const prev = merged.get(name);
    if (!prev || prev.expires < expires) {
      merged.set(name, { source: 'NWS', event: p.event, headline: `${name} 발효 중`, expires });
    }
  }
  realAlerts = [...merged.values()];
  realByHour = byHour;
  realFetchedAt = new Date().toISOString();
}

/** 실제 예보를 한 번 받아 둔다. 6초 안에 못 받으면 가상의 날씨로 진행한다. */
export function ensureRealForecast(): Promise<void> {
  loading ??= Promise.race([fetchReal(), new Promise<void>((resolve) => setTimeout(resolve, 6000))]);
  return loading;
}

// ---- 실제 예보를 못 받았을 때 쓰는 가상의 날씨 ---------------------------------

const wave = (h: number, period: number, phase: number) => Math.sin((2 * Math.PI * h) / period + phase);

function syntheticConditions(time: string): HourConditions {
  const h = Date.parse(time) / HOUR_MS;
  const hour = placeHour(time);
  const swell = Math.max(0.3, 1.3 + 0.9 * wave(h, 31, 1) + 0.4 * wave(h, 11, 0));
  const wind = Math.max(0.5, 6 + 5 * wave(h, 19, 0.5));
  return {
    time,
    waveHeightM: swell,
    swellHeightM: swell * 0.8,
    swellPeriodS: 10 + 4 * wave(h, 43, 2),
    windSpeedMs: wind,
    windGustMs: wind * 1.4,
    precipitationMm: Math.max(0, 7 * wave(h, 27, 4) - 3),
    weatherCode: 0,
    seaLevelM: wave(h, 12.42, 0),
    riverRatio: null,
    apparentTempC: 10,
    isDark: hour < 7 || hour >= 18,
    nextHighTideClock: null,
  };
}

const conditionsAt = (time: string) => realByHour?.get(time) ?? syntheticConditions(time);
const riskAt = (s: SpotDef, time: string) => computeHourlyRisk(conditionsAt(time), profileOf(s), terrainOf(s), realAlerts);

// ---- 계약 모양의 응답 만들기 ---------------------------------------------------

export function fixtureSpots(time: string): SpotsResponse {
  const spots: SpotSummary[] = SPOTS.map((s) => {
    const r = riskAt(s, time);
    return { id: s.id, name: s.name, type: s.type, lat: s.lat, lng: s.lng, score: r.score, grade: r.grade, confidence: r.confidence };
  });
  return { time, spots };
}

export function fixtureSpotRisk(id: string, from: string, hours: number, stale: boolean): SpotRiskResponse | null {
  const s = SPOTS.find((x) => x.id === id);
  if (!s) return null;
  const detail = Array.from({ length: hours }, (_, i) => riskAt(s, addHoursIso(from, i)));
  return {
    spot: { id: s.id, name: s.name, type: s.type, lat: s.lat, lng: s.lng, access: { walkMinutes: s.walkMinutes, from: s.from } },
    terrain: {
      score: s.terrain,
      slopeDeg: s.slopeDeg,
      elevationM: s.elevationM,
      cover: s.cover,
      floodFrequency: s.flood,
      factors: terrainFactors(s),
    },
    hourly: detail.map(({ time, score, grade, causes }) => ({ time, score, grade, causes })),
    alerts: realAlerts,
    forecastFetchedAt: stale ? addHoursIso(from, -8) : (realFetchedAt ?? from),
    stale,
    confidence: detail[0]?.confidence ?? terrainConfidence(s),
  };
}

export function fixtureZoneGrades(time: string): ZoneGradesResponse {
  const grades: Record<string, Grade> = {};
  for (const s of SPOTS) grades[`zone-${s.id}`] = riskAt(s, time).grade;
  return { time, grades };
}

/** 임시 위험 구역: 포인트를 중심으로 한 원. 실제 구역 도형은 개발자 A의 PMTiles로 대체한다. */
export function fixtureZonesGeoJson(): FeatureCollection<Polygon> {
  const radiusM = 170;
  return {
    type: 'FeatureCollection',
    features: SPOTS.map((s) => {
      const dLat = radiusM / 111_320;
      const dLng = radiusM / (111_320 * Math.cos((s.lat * Math.PI) / 180));
      const ring = Array.from({ length: 33 }, (_, i) => {
        const a = (2 * Math.PI * i) / 32;
        return [s.lng + dLng * Math.cos(a), s.lat + dLat * Math.sin(a)];
      });
      return {
        type: 'Feature',
        properties: { zoneId: `zone-${s.id}`, spotId: s.id },
        geometry: { type: 'Polygon', coordinates: [ring] },
      };
    }),
  };
}

const distanceKm = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const dLat = (bLat - aLat) * 111.32;
  const dLng = (bLng - aLng) * 111.32 * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
};

export function fixtureRecommendations(p: {
  lat: number;
  lng: number;
  time: string;
  radiusKm: number;
  excludeSpotId?: string;
}): RecommendationsResponse {
  const base = p.excludeSpotId ? SPOTS.find((s) => s.id === p.excludeSpotId) : undefined;
  const limit = base ? riskAt(base, p.time).score : Infinity;
  const items = SPOTS.filter((s) => s.id !== p.excludeSpotId && distanceKm(p.lat, p.lng, s.lat, s.lng) <= p.radiusKm)
    .map((s) => ({ s, r: riskAt(s, p.time) }))
    .filter(({ r }) => r.grade !== 'danger' && r.score < limit)
    .sort((a, b) => a.r.score + a.s.walkMinutes * 1.5 - (b.r.score + b.s.walkMinutes * 1.5))
    .slice(0, 5)
    .map(({ s, r }) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      lat: s.lat,
      lng: s.lng,
      score: r.score,
      // 위에서 danger를 걸러 냈으므로 남는 등급은 safe 아니면 caution이다.
      grade: r.grade === 'caution' ? ('caution' as const) : ('safe' as const),
      walkMinutes: s.walkMinutes,
      reason: s.reason,
    }));
  return { time: p.time, items };
}
