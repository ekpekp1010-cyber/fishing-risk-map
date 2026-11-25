'use client';

// 지도(WebGL)와 현재 시각은 브라우저에서만 쓸 수 있으므로 서버에서 미리 그리지 않는다.
import dynamic from 'next/dynamic';

const ExploreApp = dynamic(() => import('./ExploreApp'), {
  ssr: false,
  loading: () => (
    <div className="boot" role="status">
      지도를 불러오는 중…
    </div>
  ),
});

export default function ExploreLoader() {
  return <ExploreApp />;
}
