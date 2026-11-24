'use client';

// deck.gl과 WebGL은 브라우저에서만 쓸 수 있으므로 서버에서 미리 그리지 않는다.
import dynamic from 'next/dynamic';

const PhotorealLab = dynamic(() => import('./PhotorealLab'), {
  ssr: false,
  loading: () => (
    <div className="boot" role="status">
      화면을 불러오는 중…
    </div>
  ),
});

export default function PhotorealLabLoader() {
  return <PhotorealLab />;
}
