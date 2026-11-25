// 새 메인 화면에서 쓰는 선 아이콘. 지도 앱처럼 가늘고 둥근 선으로 그린다.

const PATHS = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4.35-4.35',
  close: 'M6 6l12 12M18 6 6 18',
  shield: 'M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3zm-3 9 2 2 4-4',
  layers: 'M12 3 2 8.5 12 14l10-5.5L12 3zM2 13.5 12 19l10-5.5',
  locate: 'M12 3v3m0 12v3M3 12h3m12 0h3M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  home: 'M4 11 12 4l8 7M6 10v9h12v-9',
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zm0 0v14m6-12v14',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 8v5m0-8h.01',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4v5l3 2',
  wave: 'M2 12c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M2 17c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2',
  wind: 'M3 8h10a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7',
  route: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm12-10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 17h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7',
  back: 'M15 5 8 12l7 7',
  chevron: 'M9 6l6 6-6 6',
  warn: 'M12 4 2 20h20L12 4zm0 6v5m0 3h.01',
  star: 'M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8L12 3.5z',
  jetty: 'M3 18h18M6 18V9m6 9V6m6 12v-8M4 9h4m2-3h4m2 4h4',
  pier: 'M3 10h18M5 10v9m14-9v9M9 10v9m6-9v9M7 6h10',
  rocks: 'M3 19 8 9l4 6 3-4 6 8H3z',
  beach: 'M4 19c3-1.5 5-1.5 8 0s5 1.5 8 0M12 15V5m0 0c-3 0-6 2-7 5h14c-1-3-4-5-7-5z',
  estuary: 'M4 4c4 4 2 8 6 10s6 3 10 6M4 12c3 2 3 5 6 6',
} as const;

export type ExIconName = keyof typeof PATHS;

/** filled: 속을 채워 그린다(저장한 곳의 별처럼 켜진 상태) */
export function ExIcon({ name, size = 22, filled = false }: { name: ExIconName; size?: number; filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
