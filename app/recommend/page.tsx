import type { Metadata } from 'next';

export const metadata: Metadata = { title: '추천 포인트 · 낚시 포인트 위험도 지도' };

// 추천 탭의 목록은 지도와 같은 시각·같은 데이터를 써야 해서 AppShell 안의 지도 화면이 그린다.
export default function RecommendRoute() {
  return null;
}
