// 누구나 바로 이해할 수 있는 화면 문구. 전문 용어(유의파고, 신뢰도 등) 대신 일상 말로 쓴다.
// 숫자가 필요한 사람을 위해 원래 문장(API의 label)은 작은 글씨로 함께 보여 준다.

import type { Cause, Confidence, Grade, SpotType } from '@/lib/contract/types';
import { BREAKPOINTS } from '@/lib/risk/constants';
import { formatPlaceTime } from './time';

// ---- 지금 바다 상태: 숫자 대신 세 단계 말로 ----
// 단계 경계는 위험도 모델의 '주의 시작', '위험 시작' 값과 같다(lib/risk/constants.ts).

export type Level = 1 | 2 | 3;

export interface PlainLevel {
  level: Level;
  /** "낮아요", "조금 높아요", "높아요" 같은 한마디 */
  text: string;
}

const levelOf = (value: number, caution: number, danger: number): Level => (value >= danger ? 3 : value >= caution ? 2 : 1);

/** 먼바다 파도 높이(m) */
export function waveLevel(heightM: number): PlainLevel {
  const level = levelOf(heightM, BREAKPOINTS.wave[1][0], BREAKPOINTS.wave[2][0]);
  return { level, text: (['낮아요', '조금 높아요', '높아요'] as const)[level - 1] };
}

/** 바람 세기(m/s) */
export function windLevel(speedMs: number): PlainLevel {
  const level = levelOf(speedMs, BREAKPOINTS.wind[1][0], BREAKPOINTS.wind[2][0]);
  return { level, text: (['약해요', '조금 세요', '세요'] as const)[level - 1] };
}

/** 등급을 행동으로 바꾼 한마디 */
export const GRADE_ACTION: Record<Grade, string> = {
  safe: '가도 괜찮아요',
  caution: '조심해서 다녀오세요',
  danger: '지금은 가지 마세요',
};

/** 핀 옆이나 목록에 쓰는 짧은 말 */
export const GRADE_SHORT: Record<Grade, string> = {
  safe: '안전',
  caution: '주의',
  danger: '위험',
};

export const TYPE_PLAIN: Record<SpotType, string> = {
  jetty: '방파제',
  pier: '부두',
  rocks: '갯바위',
  beach: '해변',
  estuary: '강 하구',
};

/** 위험 원인 코드 → 쉬운 말. 목록에 없는 코드는 API 문장을 그대로 쓴다. */
const CAUSE_PLAIN: Record<string, string> = {
  alert: '기상 특보가 나왔어요',
  thunder: '천둥·번개가 칠 수 있어요',
  wave: '파도가 높아요',
  sneaker: '큰 파도가 갑자기 덮칠 수 있어요',
  wind: '바람이 세요',
  rain: '비가 많이 와요',
  tide: '바닷물이 발밑까지 차오를 수 있어요',
  river: '강물이 불어나 있어요',
  temp: '너무 춥거나 더워요',
  dark: '어두워서 발밑이 잘 안 보여요',
  dark_overlap: '어두운 데다 다른 위험도 겹쳐요',
  lowland_tide: '낮은 곳이라 물이 차오르기 쉬워요',
  steep_swell: '가파른 바위에 큰 파도가 부딪혀요',
  slope: '바닥이 가파르고 미끄러워요',
  low_elevation: '바다와 높이 차이가 거의 없어요',
  calm: '특별히 위험한 점은 없어요',
  no_forecast: '이 시간 날씨 예보가 아직 없어요',
};

export interface PlainCause {
  text: string;
  /** 원래 문장(숫자 포함). 쉬운 말과 같으면 null */
  detail: string | null;
}

export function plainCause(c: Cause): PlainCause {
  const text = CAUSE_PLAIN[c.code];
  if (!text) return { text: c.label, detail: null };
  return { text, detail: c.label === text ? null : c.label };
}

/** 예보를 얼마나 믿을 수 있는지. 낮을 때만 알린다. */
export const CONFIDENCE_PLAIN: Record<Confidence, string | null> = {
  high: null,
  medium: null,
  low: '이곳은 예보가 덜 정확할 수 있어요. 현장에서 꼭 다시 확인하세요.',
};

/** "지금", "3시간 뒤 · 오늘 18:00", "내일 06:00" */
export function plainTime(iso: string, baseIso: string): string {
  const hours = Math.round((Date.parse(iso) - Date.parse(baseIso)) / 3_600_000);
  if (hours <= 0) return '지금';
  const when = formatPlaceTime(iso, baseIso);
  return hours < 6 ? `${hours}시간 뒤 · ${when}` : when;
}

export function walkText(minutes: number, from: string): string {
  return `${from}에서 걸어서 ${minutes}분`;
}

export const SAFETY_PLAIN = '참고용 정보예요. 현장 안내와 통제를 먼저 따르세요.';
