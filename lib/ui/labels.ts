import type { Confidence, FloodFrequency, Grade, SpotType } from '@/lib/contract/types';

export const GRADE_LABEL: Record<Grade, string> = {
  safe: '안전',
  caution: '주의',
  danger: '위험',
};

/** 색을 못 보는 사용자를 위해 핀과 배지 안에 넣는 한 글자. */
export const GRADE_GLYPH: Record<Grade, string> = {
  safe: '안',
  caution: '주',
  danger: '위',
};

export const TYPE_LABEL: Record<SpotType, string> = {
  jetty: '방파제',
  pier: '부두',
  rocks: '갯바위',
  beach: '백사장',
  estuary: '하구',
};

export const SPOT_TYPES: SpotType[] = ['jetty', 'pier', 'rocks', 'beach', 'estuary'];

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: '높음',
  medium: '보통',
  low: '낮음',
};

export const FLOOD_LABEL: Record<FloodFrequency, string> = {
  low: '낮음',
  medium: '보통',
  high: '높음',
};

export const SAFETY_NOTICE =
  '이 정보는 출조 판단을 돕는 참고 자료이며, 현지 경보·통제와 본인의 현장 판단을 대신하지 않습니다.';

export function gradeFromScore(score: number): Grade {
  if (score >= 70) return 'danger';
  if (score >= 40) return 'caution';
  return 'safe';
}
