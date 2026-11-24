// Route Handler 공통: 오류 응답, 쿼리 검사, 캐시 헤더.

import type { ApiErrorCode, ApiErrorResponse } from '../contract/types';
import { floorHour } from './assemble';
import { MissingEnvError } from './env';

const STATUS: Record<ApiErrorCode, number> = {
  BAD_REQUEST: 400,
  OUT_OF_COVERAGE: 404,
  NOT_FOUND: 404,
  FORECAST_UNAVAILABLE: 503,
  INTERNAL: 500,
};

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function errorResponse(code: ApiErrorCode, message: string): Response {
  const body: ApiErrorResponse = { error: { code, message } };
  return Response.json(body, { status: STATUS[code], headers: { 'Cache-Control': 'no-store' } });
}

/** 핸들러를 감싸 ApiError·예상 못 한 오류를 계약 모양으로 바꾼다. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError) return errorResponse(e.code, e.message);
    console.error(e);
    if (e instanceof MissingEnvError) return errorResponse('INTERNAL', '서버 설정이 끝나지 않았다.');
    return errorResponse('INTERNAL', '서버 오류');
  }
}

/** 다음 정시까지 캐시(등급이 정시 단위로 바뀐다). */
export function untilNextHour(now: Date = new Date()): Record<string, string> {
  const secs = Math.max(60, Math.floor((3_600_000 - (now.getTime() % 3_600_000)) / 1000));
  return { 'Cache-Control': `public, max-age=0, s-maxage=${secs}, stale-while-revalidate=300` };
}

/** time 쿼리: 없으면 현재 정시. 정시가 아니면 내림한다. */
export function parseTime(value: string | null, now: Date = new Date()): string {
  if (!value) return floorHour(now);
  const t = Date.parse(value);
  if (Number.isNaN(t)) throw new ApiError('BAD_REQUEST', `time 형식이 잘못됐다: ${value}`);
  return floorHour(new Date(t));
}

export function parseIntIn(value: string | null, name: string, min: number, max: number, fallback: number): number {
  if (value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new ApiError('BAD_REQUEST', `${name}는 ${min}~${max} 정수여야 한다.`);
  return n;
}

export function parseBbox(value: string | null): { west: number; south: number; east: number; north: number } | null {
  if (!value) return null;
  const p = value.split(',').map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isFinite(x))) throw new ApiError('BAD_REQUEST', 'bbox는 서,남,동,북 숫자 4개다.');
  const [west, south, east, north] = p;
  if (west >= east || south >= north) throw new ApiError('BAD_REQUEST', 'bbox의 서<동, 남<북이어야 한다.');
  return { west, south, east, north };
}
