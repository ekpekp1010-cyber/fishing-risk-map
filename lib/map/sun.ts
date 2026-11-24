// 밤낮: 시각과 좌표로 태양의 위치를 계산하고, 그 높이에 맞는 하늘색과 지도 밝기를 정한다.
// 받아 오는 자료 없이 날짜·시각·위치만으로 계산한다(오차는 해 뜨고 지는 시각 기준 1~2분).

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
/** 율리우스일: 1970-01-01 정오와 2000-01-01 정오 */
const J1970 = 2_440_588;
const J2000 = 2_451_545;
/** 지구 자전축의 기울기 */
const OBLIQUITY = RAD * 23.4397;
/** 해 뜨고 지는 순간의 태양 중심 높이. 대기 굴절과 태양 반지름만큼 지평선보다 낮다 */
export const HORIZON = -0.833;

export interface SunPosition {
  /** 지평선 위 높이(도). 음수면 지평선 아래 */
  altitude: number;
  /** 방위(도). 북 0, 동 90, 남 180, 서 270 */
  azimuth: number;
}

export function sunPosition(ms: number, lng: number, lat: number): SunPosition {
  const days = ms / DAY_MS - 0.5 + J1970 - J2000;
  const anomaly = RAD * (357.5291 + 0.98560028 * days);
  const center = RAD * (1.9148 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly) + 0.0003 * Math.sin(3 * anomaly));
  const eclipticLng = anomaly + center + RAD * 102.9372 + Math.PI;
  const declination = Math.asin(Math.sin(OBLIQUITY) * Math.sin(eclipticLng));
  const rightAscension = Math.atan2(Math.sin(eclipticLng) * Math.cos(OBLIQUITY), Math.cos(eclipticLng));
  const hourAngle = RAD * (280.16 + 360.9856235 * days) + RAD * lng - rightAscension;
  const phi = RAD * lat;
  const altitude = Math.asin(
    Math.sin(phi) * Math.sin(declination) + Math.cos(phi) * Math.cos(declination) * Math.cos(hourAngle),
  );
  const fromSouth = Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(phi) - Math.tan(declination) * Math.cos(phi),
  );
  return { altitude: altitude / RAD, azimuth: (((fromSouth / RAD + 180) % 360) + 360) % 360 };
}

export const isNight = (altitude: number) => altitude < HORIZON;

export interface SunEvent {
  /** 시각(ms) */
  at: number;
  kind: 'rise' | 'set';
}

/** 주어진 기간에 해가 뜨고 지는 시각을 순서대로 찾는다. */
export function sunEvents(fromMs: number, toMs: number, lng: number, lat: number): SunEvent[] {
  const STEP = 10 * 60_000;
  const above = (ms: number) => sunPosition(ms, lng, lat).altitude >= HORIZON;
  const events: SunEvent[] = [];
  let prev = above(fromMs);
  for (let t = fromMs + STEP; t <= toMs; t += STEP) {
    const now = above(t);
    if (now !== prev) {
      // 10분 구간 안에서 반씩 좁혀 초 단위까지 찾는다
      let lo = t - STEP;
      let hi = t;
      while (hi - lo > 1000) {
        const mid = (lo + hi) / 2;
        if (above(mid) === prev) lo = mid;
        else hi = mid;
      }
      events.push({ at: Math.round(hi / 1000) * 1000, kind: now ? 'rise' : 'set' });
      prev = now;
    }
  }
  return events;
}

/** 기간 안에서 밤인 구간을 0~1 비율로 돌려준다. 시간 막대에 밤을 표시할 때 쓴다. */
export function nightSpans(fromMs: number, toMs: number, lng: number, lat: number): Array<[number, number]> {
  const span = toMs - fromMs;
  if (span <= 0) return [];
  const spans: Array<[number, number]> = [];
  let start: number | null = isNight(sunPosition(fromMs, lng, lat).altitude) ? 0 : null;
  for (const event of sunEvents(fromMs, toMs, lng, lat)) {
    const at = (event.at - fromMs) / span;
    if (event.kind === 'set') start = at;
    else if (start !== null) {
      spans.push([start, at]);
      start = null;
    }
  }
  if (start !== null) spans.push([start, 1]);
  return spans;
}

export interface SkyLook {
  skyColor: string;
  horizonColor: string;
  fogColor: string;
  /** 지도를 덮는 어둠의 세기(0 = 한낮, 1 = 한밤) */
  darkness: number;
}

type Rgb = [number, number, number];
interface Tone {
  sky: Rgb;
  horizon: Rgb;
  fog: Rgb;
}
const DAY: Tone = { sky: [127, 178, 229], horizon: [220, 233, 245], fog: [220, 233, 245] };
/** 해가 지평선에 걸렸을 때: 위는 짙은 파랑, 지평선은 노을빛 */
const DUSK: Tone = { sky: [70, 92, 150], horizon: [240, 176, 134], fog: [226, 190, 170] };
const NIGHT: Tone = { sky: [7, 14, 34], horizon: [24, 38, 70], fog: [20, 30, 56] };
/** 이 높이 위는 한낮, 아래는 한밤으로 본다. 그 사이가 해 뜰 녘과 해 질 녘이다 */
const FULL_DAY = 8;
const FULL_NIGHT = -9;

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const mix = (a: Rgb, b: Rgb, t: number) =>
  `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(', ')})`;

/** 태양 높이에 맞는 하늘색과 어둠의 세기. 높이를 주지 않으면 한낮이다. */
export function skyLook(altitude: number | null): SkyLook {
  const alt = altitude ?? 90;
  const [from, to, t] =
    alt >= 0 ? [DUSK, DAY, smooth(clamp01(alt / FULL_DAY))] : [NIGHT, DUSK, smooth(clamp01(1 - alt / FULL_NIGHT))];
  return {
    skyColor: mix(from.sky, to.sky, t),
    horizonColor: mix(from.horizon, to.horizon, t),
    fogColor: mix(from.fog, to.fog, t),
    // 해가 지평선 조금 위에 있을 때부터 어두워지기 시작해, 박명이 끝나면 완전히 어둡다
    darkness: 1 - smooth(clamp01((alt - FULL_NIGHT) / (3 - FULL_NIGHT))),
  };
}
