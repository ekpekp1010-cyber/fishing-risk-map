'use client';

// 내가 저장한 낚시 포인트. 로그인이 아직 없어서 이 브라우저(localStorage)에만 저장한다.
// 같은 브라우저의 다른 탭과도 맞춰지도록 storage 이벤트를 듣는다.

import { useSyncExternalStore } from 'react';
import type { SpotType } from '@/lib/contract/types';

export interface SavedSpot {
  id: string;
  name: string;
  type: SpotType;
  lat: number;
  lng: number;
  /** 저장한 시각(ISO). 최신순 정렬에 쓴다 */
  savedAt: string;
}

const KEY = 'fishing-risk-map:saved-spots';
const EMPTY: SavedSpot[] = [];
const listeners = new Set<() => void>();
let cache: { raw: string | null; list: SavedSpot[] } = { raw: null, list: EMPTY };

function read(): SavedSpot[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return EMPTY;
  }
  if (raw === cache.raw) return cache.list;
  let list: SavedSpot[] = EMPTY;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) list = parsed.filter((s): s is SavedSpot => typeof s?.id === 'string');
  } catch {
    list = EMPTY;
  }
  cache = { raw, list };
  return list;
}

function write(list: SavedSpot[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // 저장소를 쓸 수 없는 환경(사생활 보호 모드 등)에서는 조용히 넘어간다.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** 저장한 곳 목록(최신순)과 저장·해제 함수 */
export function useSavedSpots() {
  const list = useSyncExternalStore(subscribe, read, () => EMPTY);
  const isSaved = (id: string) => list.some((s) => s.id === id);
  const save = (spot: Omit<SavedSpot, 'savedAt'>) => {
    if (isSaved(spot.id)) return;
    write([{ ...spot, savedAt: new Date().toISOString() }, ...read()]);
  };
  const remove = (id: string) => write(read().filter((s) => s.id !== id));
  const toggle = (spot: Omit<SavedSpot, 'savedAt'>) => (isSaved(spot.id) ? remove(spot.id) : save(spot));
  return { list, isSaved, save, remove, toggle };
}
