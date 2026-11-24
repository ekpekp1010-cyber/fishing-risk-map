import { GRADE_COLOR } from './config';
import type { Grade } from '@/lib/ui/api-types';
import { GRADE_GLYPH } from '@/lib/ui/labels';

// 등급을 색만으로 구분하지 않도록 모양(원, 삼각형, 팔각형)과 글자를 함께 쓴다.
const SHAPE: Record<Grade, string> = {
  safe: '<circle cx="16" cy="16" r="12"/>',
  caution: '<path d="M16 3.5 29.5 27h-27z"/>',
  danger: '<path d="M10.4 3h11.2L29 10.4v11.2L21.6 29H10.4L3 21.6V10.4z"/>',
};

const TEXT_Y: Record<Grade, number> = { safe: 20.5, caution: 23.5, danger: 20.5 };

export function gradeShapeSvg(grade: Grade, size = 32): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true" focusable="false">` +
    `<g fill="${GRADE_COLOR[grade]}" stroke="#fff" stroke-width="2" stroke-linejoin="round">${SHAPE[grade]}</g>` +
    `<text x="16" y="${TEXT_Y[grade]}" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">${GRADE_GLYPH[grade]}</text>` +
    `</svg>`
  );
}
