import type { Metadata } from 'next';

export const metadata: Metadata = { title: '저장한 곳 · 낚시 포인트 위험도 지도' };

// 저장 탭의 목록은 AppShell 안의 지도 화면(components/explore/ExploreApp.tsx)이 그린다.
export default function SavedRoute() {
  return null;
}
