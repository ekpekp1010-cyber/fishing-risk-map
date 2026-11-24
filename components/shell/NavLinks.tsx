'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@/components/spot/RiskBadge';

const DESTINATIONS: Array<{ href: string; label: string; icon: IconName }> = [
  { href: '/', label: '지도', icon: 'map' },
  { href: '/recommend', label: '추천', icon: 'star' },
  { href: '/settings', label: '설정', icon: 'settings' },
];

export default function NavLinks() {
  const pathname = usePathname();
  return (
    <>
      {DESTINATIONS.map((d) => (
        <Link key={d.href} href={d.href} className="nav-link" aria-current={pathname === d.href ? 'page' : undefined}>
          <span className="nav-link__icon">
            <Icon name={d.icon} />
          </span>
          {d.label}
        </Link>
      ))}
    </>
  );
}
