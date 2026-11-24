'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@/components/spot/RiskBadge';

export type AppTab = 'map' | 'recommend' | 'settings';

/** 패널의 탭. 주소가 곧 탭이라 새로고침과 뒤로 가기가 그대로 동작한다. */
export const APP_TABS: Array<{ tab: AppTab; href: string; label: string; icon: IconName }> = [
  { tab: 'map', href: '/', label: '지도', icon: 'map' },
  { tab: 'recommend', href: '/recommend', label: '추천', icon: 'star' },
  { tab: 'settings', href: '/settings', label: '설정', icon: 'settings' },
];

export function tabOf(pathname: string): AppTab {
  return APP_TABS.find((t) => t.href === pathname)?.tab ?? 'map';
}

export default function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="tabs" aria-label="주 메뉴">
      {APP_TABS.map((d) => (
        <Link key={d.href} href={d.href} className="tab" aria-current={pathname === d.href ? 'page' : undefined}>
          <Icon name={d.icon} size={20} />
          {d.label}
        </Link>
      ))}
    </nav>
  );
}
