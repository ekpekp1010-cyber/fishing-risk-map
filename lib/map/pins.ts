import { GRADE_COLOR } from './config';
import type { Grade } from '@/lib/contract/types';

// 지도 핀. 글자 없이 색으로 등급을 보여 주고, 모양(원, 삼각형, 팔각형)으로도 구분한다.
const SHAPE: Record<Grade, string> = {
  safe: '<circle cx="16" cy="16" r="12"/>',
  caution: '<path d="M16 3.5 29.5 27h-27z"/>',
  danger: '<path d="M10.4 3h11.2L29 10.4v11.2L21.6 29H10.4L3 21.6V10.4z"/>',
};

export function gradeShapeSvg(grade: Grade, size = 32): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true" focusable="false">` +
    `<g fill="${GRADE_COLOR[grade]}" stroke="#fff" stroke-width="2" stroke-linejoin="round">${SHAPE[grade]}</g>` +
    `</svg>`
  );
}
