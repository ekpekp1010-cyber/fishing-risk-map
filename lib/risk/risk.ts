// 최종 위험도 R(t), 가산점 B(t), 등급, 강제 규칙, 신뢰도, 원인 상위 3개.

import type { Cause, Confidence, Grade, HourlyRisk, RiskAlert, TerrainFactor } from '../contract/types';
import {
  BONUS,
  BONUS_MAX,
  CAUTION_MIN,
  DANGER_MIN,
  H_WEIGHT,
  LOW_CONFIDENCE_MARGIN,
  STALE_AFTER_HOURS,
  V_WEIGHT,
} from './constants';
import { computeHazard, type HazardResult, type HourConditions, type SpotProfile } from './hazard';

export function gradeOf(score: number): Grade {
  if (score >= DANGER_MIN) return 'danger';
  if (score >= CAUTION_MIN) return 'caution';
  return 'safe';
}

export interface TerrainInput {
  /** 지형 취약성 V (0~100) */
  score: number;
  confidence: Confidence;
  /** 화면용 요인. 원인 후보로 쓴다 */
  factors: TerrainFactor[];
}

export interface BonusItem {
  code: 'lowland_tide' | 'steep_swell' | 'dark_overlap';
  points: number;
}

export function computeBonus(h: HazardResult, spot: SpotProfile): { total: number; items: BonusItem[] } {
  const items: BonusItem[] = [];
  if (spot.elevationM <= BONUS.lowlandTide.maxElevationM && h.byCode.tide >= BONUS.lowlandTide.minTideScore) {
    items.push({ code: 'lowland_tide', points: BONUS.lowlandTide.points });
  }
  if (
    (spot.type === 'rocks' || spot.type === 'jetty') &&
    spot.slopeDeg >= BONUS.steepSwell.minSlopeDeg &&
    h.byCode.swell >= BONUS.steepSwell.minSwellScore
  ) {
    items.push({ code: 'steep_swell', points: BONUS.steepSwell.points });
  }
  const otherPeak = Math.max(0, ...h.factors.filter((f) => f.code !== 'dark').map((f) => f.score));
  if (h.byCode.dark > 0 && otherPeak >= BONUS.darkOverlap.minOtherScore) {
    items.push({ code: 'dark_overlap', points: BONUS.darkOverlap.points });
  }
  const total = Math.min(BONUS_MAX, items.reduce((s, i) => s + i.points, 0));
  return { total, items };
}

/** 이 시각에 발효 중인 경보 */
export function activeAlerts(alerts: RiskAlert[], time: string): RiskAlert[] {
  const t = Date.parse(time);
  return alerts.filter((a) => Date.parse(a.expires) > t);
}

export function isStale(fetchedAt: string, now: string): boolean {
  return Date.parse(now) - Date.parse(fetchedAt) > STALE_AFTER_HOURS * 3_600_000;
}

const WORST_FIRST: Confidence[] = ['low', 'medium', 'high'];
const worse = (a: Confidence, b: Confidence): Confidence =>
  WORST_FIRST[Math.min(WORST_FIRST.indexOf(a), WORST_FIRST.indexOf(b))];

/**
 * 신뢰도: 지형 신뢰도에서 시작해, 고도에 민감한 판정(조석 위험·저지대 가산)이 결과에 들어가거나
 * 핵심 예보가 빠지면 'low'로 내린다(PRD "신뢰도 표시").
 */
export function confidenceOf(terrain: TerrainInput, h: HazardResult, bonus: BonusItem[]): Confidence {
  let c = terrain.confidence;
  if (h.byCode.tide >= CAUTION_MIN || bonus.some((b) => b.code === 'lowland_tide')) c = worse(c, 'low');
  if (h.missing.length > 0) c = worse(c, 'low');
  return c;
}

/** 신뢰도 낮음이면 경계 바로 아래 점수를 경계로 올린다(위험한 쪽으로 판정). */
export function leanRisky(score: number, confidence: Confidence): number {
  if (confidence !== 'low') return score;
  for (const edge of [DANGER_MIN, CAUTION_MIN]) {
    if (score < edge && score >= edge - LOW_CONFIDENCE_MARGIN) return edge;
  }
  return score;
}

interface RankedCause extends Cause {
  weight: number;
}

/** 원인 후보를 R에 미친 영향 순서로 정렬해 최대 3개. 경보·뇌우는 항상 맨 앞. */
export function topCauses(h: HazardResult, terrain: TerrainInput, alerts: RiskAlert[], limit = 3): Cause[] {
  const ranked: RankedCause[] = [];
  for (const a of alerts) ranked.push({ code: 'alert', label: a.headline, weight: Number.POSITIVE_INFINITY });
  if (h.thunder) ranked.push({ code: 'thunder', label: '뇌우 예보', weight: Number.MAX_VALUE });
  for (const f of h.factors) ranked.push({ code: f.code, label: f.label, weight: H_WEIGHT * f.score });
  for (const f of terrain.factors) {
    if (f.score > 0 && f.label) ranked.push({ code: f.code, label: f.label, weight: V_WEIGHT * f.score });
  }
  ranked.sort((a, b) => b.weight - a.weight);

  const seen = new Set<string>();
  const out: Cause[] = [];
  for (const r of ranked) {
    if (seen.has(r.code)) continue;
    seen.add(r.code);
    out.push({ code: r.code, label: r.label });
    if (out.length === limit) break;
  }
  return out.length > 0 ? out : [{ code: 'calm', label: '뚜렷한 위험 요인 없음' }];
}

export interface RiskDetail extends HourlyRisk {
  hazard: number;
  bonus: number;
  confidence: Confidence;
  forced: 'alert' | 'thunder' | null;
}

/** 한 포인트·한 시각의 위험도. 계약의 HourlyRisk에 계산 내역을 더해 돌려준다. */
export function computeHourlyRisk(
  conditions: HourConditions,
  spot: SpotProfile,
  terrain: TerrainInput,
  alerts: RiskAlert[] = [],
): RiskDetail {
  const h = computeHazard(conditions, spot);
  const bonus = computeBonus(h, spot);
  const confidence = confidenceOf(terrain, h, bonus.items);
  const raw = Math.min(100, V_WEIGHT * terrain.score + H_WEIGHT * h.score + bonus.total);
  const score = leanRisky(Math.round(raw), confidence);

  const live = activeAlerts(alerts, conditions.time);
  const forced = live.length > 0 ? 'alert' : h.thunder ? 'thunder' : null;
  const grade: Grade = forced ? 'danger' : gradeOf(score);

  return {
    time: conditions.time,
    score,
    grade,
    causes: topCauses(h, terrain, live),
    hazard: Math.round(h.score),
    bonus: bonus.total,
    confidence,
    forced,
  };
}
