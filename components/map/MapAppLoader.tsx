'use client';

// 지도와 현재 시각은 브라우저에서만 쓸 수 있으므로, 이 화면들은 서버에서 미리 그리지 않는다.
import dynamic from 'next/dynamic';

function Loading() {
  return (
    <div className="boot" role="status">
      화면을 불러오는 중…
    </div>
  );
}

const MapApp = dynamic(() => import('./MapApp'), { ssr: false, loading: Loading });

export default function MapAppLoader() {
  return <MapApp />;
}
