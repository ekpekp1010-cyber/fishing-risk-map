import type { Confidence, Grade } from '@/lib/contract/types';
import { CONFIDENCE_LABEL, GRADE_LABEL } from '@/lib/ui/labels';

// 여러 화면이 함께 쓰는 작은 표시 요소: 아이콘, 등급 모양, 등급 배지.

const ICON_PATHS = {
  map: 'M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z',
  star: 'M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
  settings:
    'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
  search:
    'M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  layers: 'M11.99 18.54l-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z',
  locate:
    'M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3c-.46-4.17-3.77-7.48-7.94-7.94V1h-2v2.06C6.83 3.52 3.52 6.83 3.06 11H1v2h2.06c.46 4.17 3.77 7.48 7.94 7.94V23h2v-2.06c4.17-.46 7.48-3.77 7.94-7.94H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z',
  play: 'M8 5v14l11-7z',
  pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  expand: 'M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z',
} as const;

export type IconName = keyof typeof ICON_PATHS;

export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true" focusable="false">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

/** 등급 모양: 안전은 원, 주의는 삼각형, 위험은 팔각형. 글자 없이 색과 모양으로 구분한다. */
export function GradeIcon({ grade, size = 24 }: { grade: Grade; size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" focusable="false" className={`grade-shape grade-shape--${grade}`}>
      {grade === 'safe' && <circle cx="16" cy="16" r="13" />}
      {grade === 'caution' && <path d="M16 2.5 30.5 28h-29z" />}
      {grade === 'danger' && <path d="M10 2h12l8 8v12l-8 8H10l-8-8V10z" />}
    </svg>
  );
}

interface RiskBadgeProps {
  grade: Grade;
  score: number;
  timeLabel: string;
  confidence: Confidence;
}

export function RiskBadge({ grade, score, timeLabel, confidence }: RiskBadgeProps) {
  return (
    <div className={`badge badge--${grade}`} role="status" aria-live="polite">
      <GradeIcon grade={grade} size={40} />
      <div>
        <p className="badge__grade">
          {GRADE_LABEL[grade]} · {timeLabel}
        </p>
        <p className="badge__score">
          위험 점수 {score} / 100
          {confidence === 'low' && <span className="badge__flag"> · 신뢰도 {CONFIDENCE_LABEL[confidence]}</span>}
        </p>
      </div>
    </div>
  );
}
