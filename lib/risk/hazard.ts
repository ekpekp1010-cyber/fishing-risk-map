// 시간대 위험요인 H(t): 예보 값 → 요인별 0~100 점수 → H.

import type { SpotType } from '../contract/types';
import {
  BREAKPOINTS,
  type Breakpoints,
  DARK_SCORE,
  HAZARD_WEIGHTS,
  type HazardCode,
  MIN_WAVE_EXPOSURE,
  SNEAKER,
  SWELL_MIN_HEIGHT_M,
  THUNDER_CODES,
} from './constants';

/** 한 셀·한 시각의 예보. 값이 없으면 null */
export interface HourConditions {
  time: string;
  waveHeightM: number | null;
  swellHeightM: number | null;
  swellPeriodS: number | null;
  windSpeedMs: number | null;
  windGustMs: number | null;
  precipitationMm: number | null;
  weatherCode: number | null;
  /** 평균해면 기준 예측 해수면(보정값이 있으면 보정값) */
  seaLevelM: number | null;
  /** 하천 유량 / 최근 30일 중앙값 */
  riverRatio: number | null;
  apparentTempC: number | null;
  /** 일몰 후·일출 전 */
  isDark: boolean;
  /** 다음 만조 시각(화면 문장용, 현지 "HH:MM") */
  nextHighTideClock?: string | null;
}

/** 위험 계산에 쓰는 포인트의 고정 정보 */
export interface SpotProfile {
  type: SpotType;
  /** 평균해면 대비 포인트 고도(m) */
  elevationM: number;
  /** 퇴로 경로의 가장 낮은 고도(m). 모르면 null */
  egressMinElevationM: number | null;
  slopeDeg: number;
  /**
   * 외해 파랑이 이 포인트까지 들어오는 정도(0~1). 지형 요인 wave_exposure 점수/100.
   * 예보 파고는 바다 격자 값이므로 만 안쪽 포인트에서는 이만큼 줄여 본다. 모르면 1(위험한 쪽).
   */
  waveExposure?: number;
}

export interface HazardFactor {
  code: HazardCode;
  score: number;
  /** 화면용 한국어 문장 */
  label: string;
}

export interface HazardResult {
  /** 0~100 */
  score: number;
  /** 점수가 0보다 큰 요인, 점수 내림차순 */
  factors: HazardFactor[];
  /** 요인 코드별 점수(0 포함) */
  byCode: Record<HazardCode, number>;
  thunder: boolean;
  /** 핵심 예보(파고, 풍속, 해수면) 중 빠진 것 */
  missing: Array<'wave' | 'wind' | 'seaLevel'>;
}

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));

/** 구간 선형 보간. x가 줄어드는 구간(조석 여유, 추위)도 처리한다. */
export function scale(value: number, points: Breakpoints): number {
  const decreasing = points[0][0] > points[3][0];
  const x = decreasing ? -value : value;
  const pts = points.map(([px, py]) => [decreasing ? -px : px, py] as const);
  if (x <= pts[0][0]) return 0;
  if (x >= pts[3][0]) return 100;
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    if (x <= x1) {
      const [x0, y0] = pts[i - 1];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return 100;
}

const has = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
const fmt1 = (v: number) => v.toFixed(1);

/**
 * 스니커 웨이브 처오름 높이(m, 해수면 위). Stockdon(2006) 소산형 해변 식 R2 = 0.043·√(H0·L0)에
 * SNEAKER.extremeFactor를 곱한다. 처오름 유형이 아니거나 너울 값이 없으면 null.
 */
export function sneakerRunup(c: HourConditions, spot: SpotProfile, exposure: number): number | null {
  if (!(SNEAKER.types as readonly string[]).includes(spot.type)) return null;
  const h = has(c.swellHeightM) ? c.swellHeightM : c.waveHeightM;
  if (!has(h) || !has(c.swellPeriodS) || h <= 0 || c.swellPeriodS <= 0) return null;
  const h0 = h * exposure;
  const l0 = (9.81 * c.swellPeriodS ** 2) / (2 * Math.PI);
  return SNEAKER.extremeFactor * SNEAKER.coefficient * Math.sqrt(h0 * l0);
}

export function tideMargin(c: HourConditions, spot: SpotProfile): number | null {
  if (!has(c.seaLevelM)) return null;
  const ground = has(spot.egressMinElevationM) ? Math.min(spot.elevationM, spot.egressMinElevationM) : spot.elevationM;
  return ground - c.seaLevelM;
}

export function computeHazard(c: HourConditions, spot: SpotProfile): HazardResult {
  const factors: HazardFactor[] = [];
  const byCode = Object.fromEntries(Object.keys(HAZARD_WEIGHTS).map((k) => [k, 0])) as Record<HazardCode, number>;
  const add = (code: HazardCode, score: number, label: string) => {
    const s = clamp(score);
    byCode[code] = s;
    if (s > 0) factors.push({ code, score: s, label });
  };

  const exposure = Math.min(1, Math.max(MIN_WAVE_EXPOSURE, spot.waveExposure ?? 1));
  const sheltered = exposure < 1 ? ' (외해 기준, 이곳은 파랑이 줄어듦)' : '';
  if (has(c.waveHeightM)) {
    add('wave', exposure * scale(c.waveHeightM, BREAKPOINTS.wave), `유의파고 ${fmt1(c.waveHeightM)} m${sheltered}`);
  }

  const swellH = has(c.swellHeightM) ? c.swellHeightM : c.waveHeightM;
  if (has(c.swellPeriodS) && has(swellH) && swellH >= SWELL_MIN_HEIGHT_M) {
    add(
      'swell',
      exposure * scale(c.swellPeriodS, BREAKPOINTS.swell),
      `너울 주기 ${Math.round(c.swellPeriodS)}초, 파고 ${fmt1(swellH)} m${sheltered}`,
    );
  }

  if (has(c.windSpeedMs) || has(c.windGustMs)) {
    const sSpeed = has(c.windSpeedMs) ? scale(c.windSpeedMs, BREAKPOINTS.wind) : 0;
    const sGust = has(c.windGustMs) ? scale(c.windGustMs, BREAKPOINTS.gust) : 0;
    const parts = [
      has(c.windSpeedMs) ? `풍속 ${Math.round(c.windSpeedMs)} m/s` : null,
      has(c.windGustMs) ? `돌풍 ${Math.round(c.windGustMs)} m/s` : null,
    ].filter(Boolean);
    add('wind', Math.max(sSpeed, sGust), parts.join(', '));
  }

  if (has(c.precipitationMm)) add('rain', scale(c.precipitationMm, BREAKPOINTS.rain), `시간당 강수 ${fmt1(c.precipitationMm)} mm`);

  const margin = tideMargin(c, spot);
  if (margin !== null) {
    const head = c.nextHighTideClock ? `${c.nextHighTideClock} 만조, ` : '';
    const tail = margin <= 0 ? '포인트·퇴로가 물에 잠길 수 있음' : `해수면까지 여유 ${fmt1(margin)} m`;
    add('tide', scale(margin, BREAKPOINTS.tide), head + tail);
  }

  const runup = sneakerRunup(c, spot, exposure);
  if (margin !== null && runup !== null) {
    const reach = margin - runup; // 해수면 위로 밀려 올라온 물과 발밑 사이 여유
    const tail = reach <= 0 ? '파도가 포인트·퇴로까지 밀려 올라올 수 있음' : `밀려 올라온 물까지 여유 ${fmt1(reach)} m`;
    add('sneaker', scale(reach, SNEAKER.breakpoints), `너울 처오름 약 ${fmt1(runup)} m(주기 ${Math.round(c.swellPeriodS!)}초), ${tail}`);
  }

  if (spot.type === 'estuary' && has(c.riverRatio)) {
    add('river', scale(c.riverRatio, BREAKPOINTS.river), `하천 유량 평소의 ${fmt1(c.riverRatio)}배`);
  }

  if (has(c.apparentTempC)) {
    const t = c.apparentTempC;
    add('temp', Math.max(scale(t, BREAKPOINTS.cold), scale(t, BREAKPOINTS.heat)), `체감온도 ${Math.round(t)}°C`);
  }

  if (c.isDark) add('dark', DARK_SCORE, '해가 진 시간대, 시야가 어두움');

  const weighted = (Object.keys(HAZARD_WEIGHTS) as HazardCode[]).reduce((sum, k) => sum + HAZARD_WEIGHTS[k] * byCode[k], 0);
  const peak = Math.max(0, ...factors.map((f) => f.score));
  factors.sort((a, b) => b.score - a.score);

  const missing: HazardResult['missing'] = [];
  if (!has(c.waveHeightM)) missing.push('wave');
  if (!has(c.windSpeedMs) && !has(c.windGustMs)) missing.push('wind');
  if (!has(c.seaLevelM)) missing.push('seaLevel');

  return {
    score: clamp(Math.max(weighted, peak)),
    factors,
    byCode,
    thunder: has(c.weatherCode) && (THUNDER_CODES as readonly number[]).includes(c.weatherCode),
    missing,
  };
}
