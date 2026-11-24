// 화면 개발용 시뮬레이터. 실제 API가 나오기 전까지 시간에 따라 변하는 예시 응답을 만들어 낸다.
// 개발자 A의 lib/contract/fixtures는 한 시각의 고정된 예시라 시간 슬라이더를 움직여 볼 수 없어서 이것을 함께 둔다.
// 응답 타입은 lib/contract/types.ts를 그대로 쓰고, 포인트 id는 lib/contract/fixtures와 같다.
// 좌표, 이름, 점수는 모두 예시이며 실제 분석 결과가 아니다. 실제 API가 연결되면 이 파일은 지운다.

import type { FeatureCollection, Polygon } from 'geojson';
import type {
  Cause,
  FloodFrequency,
  Grade,
  HourlyRisk,
  RecommendationsResponse,
  SpotRiskResponse,
  SpotSummary,
  SpotsResponse,
  SpotType,
  ZoneGradesResponse,
} from '@/lib/contract/types';
import { gradeFromScore } from './labels';
import { addHoursIso, formatClock, placeHour } from './time';

interface SpotDef {
  id: string;
  name: string;
  type: SpotType;
  lat: number;
  lng: number;
  /** 지형 취약성 V (0~100) */
  terrain: number;
  /** 파랑 노출 정도 (0~1) */
  exposure: number;
  elevationM: number;
  slopeDeg: number;
  cover: string;
  flood: FloodFrequency;
  walkMinutes: number;
  from: string;
  reason: string;
}

const SPOTS: SpotDef[] = [
  { id: 'south-jetty-tip', name: '사우스 제티 끝', type: 'jetty', lat: 44.6124, lng: -124.0802, terrain: 78, exposure: 1, elevationM: 3, slopeDeg: 26, cover: '암반', flood: 'high', walkMinutes: 22, from: '사우스 제티 주차장', reason: '방파제 끝, 너울이 약할 때만 권장' },
  { id: 'south-jetty-mid', name: '사우스 제티 중간', type: 'jetty', lat: 44.6131, lng: -124.0712, terrain: 64, exposure: 0.8, elevationM: 3, slopeDeg: 24, cover: '암반', flood: 'high', walkMinutes: 12, from: '사우스 제티 주차장', reason: '방파제 중간, 주차장에서 12분' },
  { id: 'north-jetty-mid', name: '노스 제티 중간', type: 'jetty', lat: 44.6168, lng: -124.0745, terrain: 66, exposure: 0.85, elevationM: 3, slopeDeg: 25, cover: '암반', flood: 'high', walkMinutes: 15, from: '노스 제티 진입로', reason: '방파제 중간, 진입로에서 15분' },
  { id: 'nye-rocks', name: '나이 비치 남쪽 암반', type: 'rocks', lat: 44.6362, lng: -124.0652, terrain: 70, exposure: 0.9, elevationM: 2, slopeDeg: 21, cover: '암반', flood: 'high', walkMinutes: 9, from: '나이 비치 주차장', reason: '암반 해안, 간조 때만 접근' },
  { id: 'nye-beach', name: '나이 비치', type: 'beach', lat: 44.6408, lng: -124.0638, terrain: 38, exposure: 0.7, elevationM: 4, slopeDeg: 4, cover: '모래', flood: 'medium', walkMinutes: 4, from: '나이 비치 주차장', reason: '완만한 모래 해변, 주차장에서 4분' },
  { id: 'agate-beach', name: '아게이트 비치', type: 'beach', lat: 44.6638, lng: -124.0608, terrain: 42, exposure: 0.75, elevationM: 4, slopeDeg: 5, cover: '모래', flood: 'medium', walkMinutes: 7, from: '아게이트 비치 주차장', reason: '넓은 모래 해변, 주차장에서 7분' },
  { id: 'south-beach', name: '사우스 비치', type: 'beach', lat: 44.6022, lng: -124.0682, terrain: 36, exposure: 0.7, elevationM: 5, slopeDeg: 4, cover: '모래', flood: 'low', walkMinutes: 8, from: '사우스 비치 주립공원 주차장', reason: '퇴로가 넓은 모래 해변, 주차장에서 8분' },
  { id: 'bay-st-pier', name: '베이 스트리트 부두', type: 'pier', lat: 44.6302, lng: -124.0521, terrain: 18, exposure: 0.15, elevationM: 6, slopeDeg: 1, cover: '인공 구조물', flood: 'low', walkMinutes: 3, from: '베이프런트 주차장', reason: '파랑이 가려지는 만 안쪽, 주차장에서 3분' },
  { id: 'abbey-st-pier', name: '애비 스트리트 부두', type: 'pier', lat: 44.6312, lng: -124.0561, terrain: 20, exposure: 0.2, elevationM: 6, slopeDeg: 1, cover: '인공 구조물', flood: 'low', walkMinutes: 2, from: '베이프런트 주차장', reason: '난간이 있는 만 안쪽 부두, 주차장에서 2분' },
  { id: 'south-beach-pier', name: '사우스 비치 공용 부두', type: 'pier', lat: 44.6236, lng: -124.0498, terrain: 22, exposure: 0.25, elevationM: 5, slopeDeg: 1, cover: '인공 구조물', flood: 'low', walkMinutes: 4, from: '사우스 비치 마리나 주차장', reason: '만 안쪽 공용 부두, 주차장에서 4분' },
  { id: 'idaho-flat', name: '아이다호 플랫 하구', type: 'estuary', lat: 44.6189, lng: -124.0421, terrain: 46, exposure: 0.2, elevationM: 1, slopeDeg: 1, cover: '갯벌', flood: 'high', walkMinutes: 6, from: '해트필드 해양과학센터 주차장', reason: '파랑은 약하지만 밀물에 잠기는 갯벌' },
];

const HOUR_MS = 3_600_000;
const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));
const wave = (h: number, period: number, phase: number) => Math.sin((2 * Math.PI * h) / period + phase);

interface Conditions {
  swellHeight: number;
  swellPeriod: number;
  wind: number;
  tide: number;
  rain: number;
  night: boolean;
  alert: boolean;
}

function conditions(time: string): Conditions {
  const h = Date.parse(time) / HOUR_MS;
  const hour = placeHour(time);
  const slot = ((Math.floor(h) % 97) + 97) % 97;
  return {
    swellHeight: Math.max(0.3, 1.3 + 0.9 * wave(h, 31, 1) + 0.4 * wave(h, 11, 0)),
    swellPeriod: 10 + 4 * wave(h, 43, 2),
    wind: Math.max(0.5, 6 + 5 * wave(h, 19, 0.5)),
    tide: 1.1 + wave(h, 12.42, 0),
    rain: Math.max(0, 7 * wave(h, 27, 4) - 3),
    night: hour < 7 || hour >= 18,
    alert: slot >= 60 && slot < 66,
  };
}

function nextHighTideClock(time: string): string {
  let best = time;
  let bestTide = -Infinity;
  for (let i = 0; i <= 13; i++) {
    const t = addHoursIso(time, i);
    const tide = conditions(t).tide;
    if (tide > bestTide) {
      bestTide = tide;
      best = t;
    }
  }
  return formatClock(best);
}

function terrainLabel(s: SpotDef): string {
  if (s.slopeDeg >= 20) return `급경사 ${s.cover}, 경사 ${s.slopeDeg}°`;
  if (s.elevationM <= 2) return `저지대 ${s.cover}, 평균해면보다 ${s.elevationM} m 높음`;
  return `${s.cover} 지형, 경사 ${s.slopeDeg}°`;
}

function riskAt(s: SpotDef, time: string): HourlyRisk {
  const c = conditions(time);
  const swell = clamp(
    (c.swellHeight - 0.4) * 42 * s.exposure + (c.swellPeriod >= 10 && c.swellHeight >= 1 ? 12 * s.exposure : 0),
  );
  const wind = clamp(c.wind * 6 * (0.5 + 0.5 * s.exposure));
  const margin = s.elevationM - c.tide;
  const tide = s.elevationM <= 4 ? clamp((2.4 - margin) * 38) : 0;
  const rain = clamp(c.rain * 9);

  const factors: Array<Cause & { score: number }> = [
    { code: 'swell', label: `너울 주기 ${Math.round(c.swellPeriod)}초, 파고 ${c.swellHeight.toFixed(1)} m`, score: swell },
    { code: 'wind', label: `풍속 ${Math.round(c.wind)} m/s`, score: wind },
    { code: 'tide', label: `${nextHighTideClock(time)} 만조, 해수면까지 여유 ${Math.max(0, margin).toFixed(1)} m`, score: tide },
    { code: 'terrain', label: terrainLabel(s), score: s.terrain * 0.85 },
  ];
  if (c.rain > 0.5) factors.push({ code: 'rain', label: `시간당 강수 ${c.rain.toFixed(1)} mm`, score: rain });
  if (c.night) factors.push({ code: 'dark', label: '해가 진 시간대, 시야가 어두움', score: 34 });

  const weighted = 0.4 * swell + 0.2 * wind + 0.25 * tide + 0.15 * rain;
  const peak = Math.max(swell, wind, tide, rain);
  const hazard = Math.max(weighted, peak * 0.85);
  const bonus = (s.elevationM <= 3 && c.tide > 1.7 ? 8 : 0) + (s.slopeDeg >= 20 && c.swellPeriod >= 12 ? 8 : 0);

  let score = Math.round(clamp(0.4 * s.terrain + 0.6 * hazard + bonus));
  let grade: Grade = gradeFromScore(score);
  const causes: Cause[] = [...factors]
    .sort((a, b) => b.score - a.score)
    .map(({ code, label }) => ({ code, label }));
  if (c.alert) {
    grade = 'danger';
    score = Math.max(score, 70);
    causes.unshift({ code: 'alert', label: '높은 파도 주의보 발효 중' });
  }
  return { time, score, grade, causes: causes.slice(0, 3) };
}

const confidenceOf = (s: SpotDef) => (s.elevationM <= 2 ? 'low' : s.type === 'pier' ? 'high' : 'medium');

export function fixtureSpots(time: string): SpotsResponse {
  const spots: SpotSummary[] = SPOTS.map((s) => {
    const r = riskAt(s, time);
    return { id: s.id, name: s.name, type: s.type, lat: s.lat, lng: s.lng, score: r.score, grade: r.grade, confidence: confidenceOf(s) };
  });
  return { time, spots };
}

export function fixtureSpotRisk(id: string, from: string, hours: number, stale: boolean): SpotRiskResponse | null {
  const s = SPOTS.find((x) => x.id === id);
  if (!s) return null;
  const hourly = Array.from({ length: hours }, (_, i) => riskAt(s, addHoursIso(from, i)));
  const alertHours = hourly.filter((h) => h.causes.some((c) => c.code === 'alert'));
  return {
    spot: { id: s.id, name: s.name, type: s.type, lat: s.lat, lng: s.lng, access: { walkMinutes: s.walkMinutes, from: s.from } },
    terrain: {
      score: s.terrain,
      slopeDeg: s.slopeDeg,
      elevationM: s.elevationM,
      cover: s.cover,
      floodFrequency: s.flood,
      factors: [
        { code: 'slope', label: `경사 ${s.slopeDeg}°`, score: clamp(s.slopeDeg * 3.2) },
        { code: 'low_elevation', label: `평균해면보다 ${s.elevationM} m 높음`, score: clamp(100 - s.elevationM * 16) },
        { code: 'exposure', label: s.exposure >= 0.6 ? '외해로 열린 방향' : '만 안쪽, 파랑이 가려짐', score: clamp(s.exposure * 100) },
      ],
    },
    hourly,
    alerts:
      alertHours.length > 0
        ? [
            {
              source: 'NWS',
              event: 'High Surf Advisory',
              headline: `높은 파도 주의보 (${formatClock(alertHours[0].time)}부터)`,
              expires: addHoursIso(alertHours[alertHours.length - 1].time, 1),
            },
          ]
        : [],
    forecastFetchedAt: addHoursIso(from, stale ? -8 : 0),
    stale,
    confidence: confidenceOf(s),
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
