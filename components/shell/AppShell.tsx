'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { APP_TABS } from './NavLinks';
// 새 메인 화면(실사 3D 지도 + 지도 앱 방식 UI). 이전 화면은 components/map/MapApp.tsx에 남아 있다.
import ExploreLoader from '@/components/explore/ExploreLoader';

// 지도, 추천, 설정은 한 화면이다. 지도가 화면 전체를 채우고, 메뉴와 내용은 그 위에 뜬 패널 하나에 들어간다.
// 이 골격은 레이아웃에 있어서 메뉴를 오가도 지도가 다시 만들어지지 않는다.
// 세 탭의 내용은 모두 패널이 직접 그리므로 페이지가 주는 children은 비어 있다.
// 그 밖의 주소(시험 화면, 없는 주소)는 내용을 그대로 보여 준다.
export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // '/saved'(저장한 곳)는 새 메인 화면의 탭이다.
  const inApp = pathname === '/saved' || APP_TABS.some((t) => t.href === pathname);
  return (
    <main className="shell">
      {inApp && <ExploreLoader />}
      {children}
    </main>
  );
}
