import type { Metadata } from 'next';
import { RecommendPageLoader } from '@/components/map/MapAppLoader';

export const metadata: Metadata = { title: '추천 포인트 · 낚시 포인트 위험도 지도' };

export default function RecommendRoute() {
  return <RecommendPageLoader />;
}
