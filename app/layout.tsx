import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import AppShell from '@/components/shell/AppShell';
import '@/styles/tokens.css';
import '@/styles/globals.css';
import '@/styles/app.css';

export const metadata: Metadata = {
  title: '낚시 포인트 위험도 지도',
  description: '위성·지형 데이터와 기상·해양 예보로 낚시 포인트별 위험을 3D 지도에 보여 줍니다.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fef7ff' },
    { media: '(prefers-color-scheme: dark)', color: '#141218' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
