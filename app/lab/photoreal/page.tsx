import type { Metadata } from 'next';
import PhotorealLabLoader from '@/components/map/PhotorealLabLoader';

// 0단계 확인용 시험 화면. 내비게이션에 넣지 않고 주소로만 연다.
export const metadata: Metadata = {
  title: '실사 3D 시험',
  robots: { index: false, follow: false },
};

export default function PhotorealLabPage() {
  return <PhotorealLabLoader />;
}
