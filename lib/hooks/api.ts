'use client';

// 화면이 데이터를 받는 유일한 통로. 예시 데이터와 실제 API를 한 곳에서 바꾼다.
//   NEXT_PUBLIC_USE_FIXTURES=0 이면 실제 API(/api/...)를 부르고, 그 밖에는 예시 데이터를 쓴다.
//   개발자 A의 API가 올라오면 .env.local에 NEXT_PUBLIC_USE_FIXTURES=0 을 넣는다.

import { useEffect, useSyncExternalStore } from 'react';
import type {
  ApiErrorCode,
  RecommendationsResponse,
  SpotRiskResponse,
  SpotsResponse,
  ZoneGradesResponse,
} from '@/lib/contract/types';
import * as contractFixtures from '@/lib/contract/fixtures';
import {
  ensureRealForecast,
  fixtureRecommendations,
  fixtureSpotRisk,
  fixtureSpots,
  fixtureZoneGrades,
} from '@/lib/ui/dev-fixtures';
import { PILOT } from '@/lib/map/config';

export const USE_FIXTURES = process.env.NEXT_PUBLIC_USE_FIXTURES !== '0';

export class ApiError extends Error {
  constructor(
    public code: ApiErrorCode | 'NETWORK',
    message: string,
  ) {
    super(message);
  }
}

export type ApiRequest =
  | { kind: 'spots'; time: string }
  | { kind: 'spotRisk'; id: string; from: string; hours: number }
  | { kind: 'zoneGrades'; time: string }
  | { kind: 'recommendations'; lat: number; lng: number; time: string; radiusKm: number; excludeSpotId?: string };

interface ResponseMap {
  spots: SpotsResponse;
  spotRisk: SpotRiskResponse;
  zoneGrades: ZoneGradesResponse;
  recommendations: RecommendationsResponse;
}

export type Resource<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; error: ApiError };

// ---- 예시 데이터 경로 -----------------------------------------------------
// 기본은 시간에 따라 변하는 시뮬레이터(lib/ui/dev-fixtures.ts)다.
// 주소에 ?demo=stale | error | coverage | slow 를 붙이면 해당 화면 상태를 확인할 수 있다.
// 주소에 ?demo=contract | contract-empty 를 붙이면 개발자 A의 예시 응답(lib/contract/fixtures)을 그대로 보여 준다.

const demoMode = () => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('demo'));
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 계약의 예시 응답을 그대로 돌려준다. 화면이 계약대로 그려지는지 확인하는 용도라 시각은 고정이다. */
function runContractFixture(req: ApiRequest, empty: boolean): unknown {
  switch (req.kind) {
    case 'spots':
      return empty ? contractFixtures.spotsEmpty : contractFixtures.spots;
    case 'spotRisk': {
      const found = [contractFixtures.spotRisk, contractFixtures.spotRiskStale].find((r) => r.spot.id === req.id);
      if (!found) throw new ApiError('NOT_FOUND', '예시 응답에 없는 포인트');
      return found;
    }
    case 'zoneGrades':
      return contractFixtures.zoneGrades;
    case 'recommendations':
      return empty ? contractFixtures.recommendationsEmpty : contractFixtures.recommendations;
  }
}

async function runFixture(req: ApiRequest): Promise<unknown> {
  const demo = demoMode();
  await wait(demo === 'slow' ? 2500 : 120);
  if (demo === 'contract' || demo === 'contract-empty') return runContractFixture(req, demo === 'contract-empty');
  // 등급을 실제 예보와 공식 경보로 계산한다. 지도의 실시간 파고·바람 레이어와 같은 데이터를 보게 된다.
  await ensureRealForecast();
  switch (req.kind) {
    case 'spots':
      if (demo === 'coverage') throw new ApiError('OUT_OF_COVERAGE', '분석되지 않은 지역');
      return fixtureSpots(req.time);
    case 'spotRisk': {
      if (demo === 'error') throw new ApiError('INTERNAL', '예시 오류');
      const res = fixtureSpotRisk(req.id, req.from, req.hours, demo === 'stale');
      if (!res) throw new ApiError('NOT_FOUND', '포인트를 찾을 수 없음');
      return res;
    }
    case 'zoneGrades':
      return fixtureZoneGrades(req.time);
    case 'recommendations':
      return fixtureRecommendations(req);
  }
}

// ---- 실제 API 경로 --------------------------------------------------------

function toUrl(req: ApiRequest): string {
  const q = new URLSearchParams();
  switch (req.kind) {
    case 'spots':
      q.set('bbox', PILOT.bbox.join(','));
      q.set('time', req.time);
      return `/api/spots?${q}`;
    case 'spotRisk':
      q.set('from', req.from);
      q.set('hours', String(req.hours));
      return `/api/spots/${encodeURIComponent(req.id)}/risk?${q}`;
    case 'zoneGrades':
      q.set('time', req.time);
      return `/api/zones/grades?${q}`;
    case 'recommendations':
      q.set('lat', String(req.lat));
      q.set('lng', String(req.lng));
      q.set('time', req.time);
      q.set('radiusKm', String(req.radiusKm));
      if (req.excludeSpotId) q.set('excludeSpotId', req.excludeSpotId);
      return `/api/recommendations?${q}`;
  }
}

async function runFetch(req: ApiRequest): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(toUrl(req));
  } catch {
    throw new ApiError('NETWORK', '서버에 연결하지 못함');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: ApiErrorCode; message?: string } } | null;
    throw new ApiError(body?.error?.code ?? 'INTERNAL', body?.error?.message ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ---- 캐시와 구독 ----------------------------------------------------------

const LOADING: Resource<never> = { status: 'loading' };
const cache = new Map<string, Resource<unknown>>();
const lastReady = new Map<string, unknown>();
const listeners = new Set<() => void>();
const MAX_ENTRIES = 400;

const emit = () => listeners.forEach((l) => l());
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

function load(key: string) {
  if (cache.has(key)) return;
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, LOADING);
  const req = JSON.parse(key) as ApiRequest;
  (USE_FIXTURES ? runFixture(req) : runFetch(req))
    .then(
      (data) => {
        cache.set(key, { status: 'ready', data });
        lastReady.set(req.kind, data);
      },
      (e: unknown) => {
        const error = e instanceof ApiError ? e : new ApiError('NETWORK', '알 수 없는 오류');
        cache.set(key, { status: 'error', error });
      },
    )
    .then(emit);
}

/** 요청 하나의 상태를 구독한다. req가 null이면 아무것도 부르지 않는다. */
export function useApi<K extends ApiRequest['kind']>(
  req: Extract<ApiRequest, { kind: K }> | null,
): Resource<ResponseMap[K]> {
  const key = req ? JSON.stringify(req) : null;
  const snapshot = useSyncExternalStore(
    subscribe,
    () => (key ? cache.get(key) : undefined),
    () => undefined,
  );
  useEffect(() => {
    if (key) load(key);
  }, [key]);
  return (snapshot ?? LOADING) as Resource<ResponseMap[K]>;
}

/** 같은 종류의 요청 중 가장 최근에 받은 응답. 새 시각을 불러오는 동안 화면이 비지 않게 한다. */
export function useLastReady<K extends ApiRequest['kind']>(kind: K): ResponseMap[K] | null {
  const value = useSyncExternalStore(
    subscribe,
    () => lastReady.get(kind),
    () => undefined,
  );
  return (value as ResponseMap[K] | undefined) ?? null;
}

export function retry(req: ApiRequest) {
  const key = JSON.stringify(req);
  cache.delete(key);
  load(key);
  emit();
}
