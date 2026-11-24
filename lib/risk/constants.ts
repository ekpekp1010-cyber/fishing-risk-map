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

// 2026-11-24 게이트 2 보정: PRD 초기값(파고 주의 1.0·위험 2.0 m, 너울 10·14초, 돌풍=풍속 구간)으로는
// 오리건 외해의 평상시에도 거의 늘 주의 이상(겨울 정오 '안전' 3%)이었다. 파랑은 시범 지역 기후값
// (2023~2025 겨울 정오 유의파고 75%·97% 백분위 3.1·4.8 m, 너울 주기 10.5·13.2초)으로, 돌풍은 풍속 구간 ×1.5로 바꿨다.
// 사고 6건 재현 6/6 유지, 겨울 정오 '안전' 29%·'위험' 19%. 근거: pipeline/validation/README.md, sweep.mjs.
export const BREAKPOINTS = {
  /** 외해 유의파고(m). 포인트에는 파랑 노출 정도를 곱해 쓴다. PRD 초기값: 주의 1.0, 위험 2.0 */
  wave: [[1.0, 0], [3.1, 40], [4.8, 70], [7.2, 100]],
  /** 너울 주기(초), 파고 1 m 이상일 때만. PRD 초기값: 주의 10, 위험 14 */
  swell: [[8, 0], [10.5, 40], [13.2, 70], [17.2, 100]],
  /** 10 m 평균 풍속(m/s). PRD: 주의 8, 위험 14 */
  wind: [[3, 0], [8, 40], [14, 70], [20, 100]],
  /** 10 m 돌풍(m/s). 풍속 구간 × 1.5(돌풍 계수) */
  gust: [[4.5, 0], [12, 40], [21, 70], [30, 100]],
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

/**
 * 파랑·너울 점수에 곱하는 노출 정도의 하한. 만 안쪽이라도 큰 너울은 일부 들어온다고 본다(정한 값).
 * 노출 정도 = 지형 요인 wave_exposure 점수 / 100.
 */
export const MIN_WAVE_EXPOSURE = 0.25;

/**
 * 스니커 웨이브(처오름) 요인. 오리건 주립대 연구(2023, Natural Hazards and Earth System Sciences)는
 * 먼 폭풍의 긴 주기 너울이 해변을 크게 밀어 올리는 극한 처오름을 스니커 웨이브의 원인으로 봤다.
 * 처오름 높이는 Stockdon et al.(2006) 소산형 해변 식: R2 = 0.043 × √(H0 × L0), L0 = g·T²/2π
 * (H0 = 외해 너울 파고 × 파랑 노출 정도, T = 너울 주기). 주기가 길수록 L0가 커져 처오름이 커진다.
 * 판정: 여유 = 포인트·퇴로 중 낮은 고도 − (해수면 + extremeFactor × R2). 조석과 같은 구간으로 점수화.
 * 처오름이 의미 있는 유형(해변·갯바위·방파제)에만 쓴다. 부두 상판과 하구 갯벌은 뺀다.
 */
export const SNEAKER = {
  coefficient: 0.043,
  /** R2(상위 2% 처오름)에 곱하는 값. 스니커 웨이브는 R2보다 드문 극한값이다 */
  extremeFactor: 1.0,
  types: ['beach', 'rocks', 'jetty'] as const,
  breakpoints: [[2.0, 0], [1.0, 40], [0.5, 70], [0, 100]] as const satisfies Breakpoints,
};

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
  wave: 0.2,
  swell: 0.1,
  sneaker: 0.1,
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

/**
 * 추천(PRD F4). 정렬 키 = 위험 점수 + walkPointsPerMinute × 도보 분.
 * PRD에는 "위험도가 낮고 접근성이 좋은"까지만 있어 가중치는 정한 값이다.
 */
export const RECOMMEND = {
  maxItems: 5,
  defaultRadiusKm: 30,
  walkPointsPerMinute: 1.5,
  /** 도보 시간을 모르면 이만큼으로 본다(뒤로 밀린다) */
  unknownWalkMinutes: 20,
  /** 지형 요인 wave_exposure 점수가 이 이하이면 "파랑이 가려지는" */
  shelteredMaxExposure: 30,
} as const;
