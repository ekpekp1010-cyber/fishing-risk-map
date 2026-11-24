import type { ReactNode } from 'react';
import NavLinks from './NavLinks';

// 넓은 화면에서는 왼쪽 Navigation rail, 좁은 화면에서는 아래 Navigation bar가 된다(styles/app.css).
export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <nav className="shell__nav" aria-label="주 메뉴">
        <NavLinks />
      </nav>
      <main className="shell__main">{children}</main>
    </div>
  );
}
