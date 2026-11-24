// 위험도 모델의 모든 수치. 출처는 docs/prd.md "위험도 모델"이며 모두 초기 제안값이다.
// 시범 지역 과거 사고 사례로 보정할 때는 이 파일만 고친다.

import type { Grade } from '../contract/types';

/** R(t) = min(100, V_WEIGHT·V + H_WEIGHT·H(t) + B(t)) */
export const V_WEIGHT = 0.4;
export const H_WEIGHT = 0.6;
export const BONUS_MAX = 20;

/** 등급 경계: 0~39 safe, 40~69 caution, 70~100 danger */
export const CAUTION_MIN = 40;
export const DANGER_MIN = 70;

/** 예보 수집 후 이 시간이 넘으면 stale */
export const STALE_AFTER_HOURS = 6;

/**
 * 요인 점수 구간: [값, 점수] 4개. 두 번째·세 번째 점이 PRD의 '주의 시작'·'위험 시작'이고
 * 각각 등급 경계 40점·70점에 맞춘다. 첫 점(0점)과 마지막 점(100점)은 PRD에 없어 정한 값이다.
 * 값이 작을수록 위험한 요인(조석 여유)은 x가 줄어드는 순서로 적는다.
 */
export type Breakpoints = readonly [readonly [number, 0], readonly [number, 40], readonly [number, 70], readonly [number, 100]];

export const BREAKPOINTS = {
  /** 유의파고(m). PRD: 주의 1.0, 위험 2.0 */
  wave: [[0.3, 0], [1.0, 40], [2.0, 70], [4.0, 100]],
  /** 너울 주기(초), 파고 1 m 이상일 때만. PRD: 주의 10, 위험 14 */
  swell: [[6, 0], [10, 40], [14, 70], [18, 100]],
  /** 10 m 풍속·돌풍(m/s). PRD: 주의 8, 위험 14. 돌풍에도 같은 구간을 쓴다(위험한 쪽) */
  wind: [[3, 0], [8, 40], [14, 70], [20, 100]],
  /** 시간당 강수(mm). PRD: 주의 5, 위험 20 */
  rain: [[0, 0], [5, 40], [20, 70], [50, 100]],
  /** 포인트·퇴로 고도와 예측 해수면의 차(m). PRD: 주의 1.0 이내, 위험 0.5 이내 */
  tide: [[2.0, 0], [1.0, 40], [0.5, 70], [0, 100]],
  /** 하천 유량 / 최근 30일 중앙값(배), 하구만. PRD: 주의 2배, 위험 4배 */
  river: [[1, 0], [2, 40], [4, 70], [8, 100]],
  /** 체감온도 추위(°C). PRD: 주의 0 이하, 위험 -10 이하 */
  cold: [[8, 0], [0, 40], [-10, 70], [-20, 100]],
  /** 체감온도 더위(°C). PRD: 주의 31 이상, 위험 35 이상 */
  heat: [[26, 0], [31, 40], [35, 70], [40, 100]],
} as const satisfies Record<string, Breakpoints>;

/** 너울 주기를 따지는 최소 파고(m). PRD: 파고 1 m 이상일 때 */
export const SWELL_MIN_HEIGHT_M = 1.0;

/** 시야: 일몰 후·일출 전이면 '주의 시작' 점수 */
export const DARK_SCORE = CAUTION_MIN;

/** 뇌우로 보는 WMO 날씨 코드 */
export const THUNDER_CODES = [95, 96, 99] as const;

/**
 * H(t) 가중합의 가중치. PRD에는 수치가 없어 정한 초기값이다(합 1).
 * 합이 1이면 가중합은 최댓값을 넘지 못하므로 H(t)는 사실상 가장 큰 요인 점수가 된다.
 * 여러 요인이 겹치는 효과를 키우려면 보정 단계에서 합을 1보다 크게 잡는다.
 */
export const HAZARD_WEIGHTS = {
  wave: 0.25,
  swell: 0.15,
  wind: 0.15,
  rain: 0.1,
  tide: 0.2,
  river: 0.05,
  temp: 0.05,
  dark: 0.05,
} as const;

export type HazardCode = keyof typeof HAZARD_WEIGHTS;

/** B(t) 가산 규칙. PRD 예시: 저지대+만조, 급경사 암반+긴 주기 너울. 시야는 '다른 요인과 겹칠 때 가산' */
export const BONUS = {
  lowlandTide: { points: 10, maxElevationM: 3, minTideScore: CAUTION_MIN },
  steepSwell: { points: 10, minSlopeDeg: 20, minSwellScore: CAUTION_MIN },
  darkOverlap: { points: 5, minOtherScore: CAUTION_MIN },
} as const;

/** 신뢰도 낮음일 때 '위험한 쪽으로 판정': 경계 아래 이 점수 안이면 경계로 올린다 */
export const LOW_CONFIDENCE_MARGIN = 5;

export const GRADE_ORDER: readonly Grade[] = ['safe', 'caution', 'danger'];
