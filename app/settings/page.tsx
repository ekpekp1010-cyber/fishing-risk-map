import type { Metadata } from 'next';

export const metadata: Metadata = { title: '설정과 출처 · 낚시 포인트 위험도 지도' };

// 설정 탭의 내용은 AppShell 안의 패널이 그린다(components/shell/SettingsPanel.tsx).
export default function SettingsRoute() {
  return null;
}
