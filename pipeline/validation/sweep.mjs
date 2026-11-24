// 파랑 임계값 후보 비교: 사고 재현율과 대조군(평소 등급)을 함께 본다.
//   node pipeline/validation/sweep.mjs     (gate2.mjs, control.mjs를 먼저 돌린다)
// 컴파일된 lib/risk의 BREAKPOINTS를 바꿔 같은 계산을 다시 한다(네트워크 없음).

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const CJS = join(ROOT, 'node_modules/.cache/fishrisk-risk-cjs/risk');
const risk = require(join(CJS, 'index.js'));
const constants = require(join(CJS, 'constants.js'));
const ORIGINAL = structuredClone(constants.BREAKPOINTS);
const SNEAKER0 = { ...constants.SNEAKER };

const OUT = join(ROOT, 'pipeline/out/incidents');
const terrain = JSON.parse(readFileSync(join(OUT, 'terrain.json'), 'utf8'));
const results = JSON.parse(readFileSync(join(OUT, 'results.json'), 'utf8'));
const control = JSON.parse(readFileSync(join(OUT, 'control_samples.json'), 'utf8'));

const incidents = results.map((r) => {
  const t = terrain.find((x) => x.incident.id === r.id);
  const exposure = t.factors.find((f) => f.code === 'wave_exposure');
  return {
    id: r.id,
    c: r.target.conditions,
    live: r.target.alerts.map((e) => ({ source: 'NWS', event: e, headline: e, expires: '2100-01-01T00:00:00Z' })),
    profile: { type: t.incident.type, elevationM: t.elevation_m, egressMinElevationM: t.egress_min_elevation_m, slopeDeg: t.slope_deg,
      waveExposure: exposure ? exposure.score / 100 : 1 },
    tin: { score: t.score, confidence: t.confidence, factors: t.factors.map(({ code, label, score }) => ({ code, label, score })) },
  };
});

// ---- 파랑 기후값(대조군, 외해 쪽 지점의 10~4월 정오) ----
const q = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a[Math.floor(p * (a.length - 1))]; };
const winter = control.filter((s) => s.season === 'winter');
const hs = winter.map((s) => s.c.waveHeightM).filter((x) => x != null);
const tp = winter.filter((s) => (s.c.swellHeightM ?? 0) >= 1).map((s) => s.c.swellPeriodS).filter((x) => x != null);
console.log(`겨울 정오 유의파고 백분위 50/75/90/97%: ${[0.5, 0.75, 0.9, 0.97].map((p) => q(hs, p).toFixed(2)).join(' / ')} m`);
console.log(`겨울 정오 너울 주기(파고 1 m 이상) 50/75/90/97%: ${[0.5, 0.75, 0.9, 0.97].map((p) => q(tp, p).toFixed(1)).join(' / ')} s\n`);

// PRD 초기값(2026-11-24 이전 lib/risk/constants.ts)
const PRD = {
  wave: [[0.3, 0], [1.0, 40], [2.0, 70], [4.0, 100]],
  swell: [[6, 0], [10, 40], [14, 70], [18, 100]],
  gust: [[3, 0], [8, 40], [14, 70], [20, 100]],
};
const G15 = [[4.5, 0], [12, 40], [21, 70], [30, 100]]; // 돌풍 = 풍속 구간 × 1.5
const WC = [[1.0, 0], [3.1, 40], [4.8, 70], [7.2, 100]]; // 유의파고: 겨울 정오 75/97% 기후값
const SC = [[8, 0], [10.5, 40], [13.2, 70], [17.2, 100]]; // 너울 주기: 겨울 정오 75/97% 기후값
const CANDIDATES = {
  'A PRD 초기값': { wave: PRD.wave, swell: PRD.swell, gust: PRD.gust },
  'B 돌풍만 ×1.5': { wave: PRD.wave, swell: PRD.swell, gust: G15 },
  'C 파랑 기후 75/97%': { wave: WC, swell: SC, gust: PRD.gust },
  'D 파랑 기후+돌풍×1.5 (채택)': { wave: WC, swell: SC, gust: G15 },
  'E 2.5/4 m, 12/16 s+돌풍×1.5': { wave: [[1.0, 0], [2.5, 40], [4.0, 70], [6.5, 100]], swell: [[8, 0], [12, 40], [16, 70], [20, 100]], gust: G15 },
  'F 2/3.5 m, 11/15 s+돌풍×1.5': { wave: [[0.8, 0], [2.0, 40], [3.5, 70], [6.0, 100]], swell: [[7, 0], [11, 40], [15, 70], [19, 100]], gust: G15 },
  'D + 처오름 ×1.0': { wave: WC, swell: SC, gust: G15, sneaker: 1.0 },
  'D + 처오름 ×1.5': { wave: WC, swell: SC, gust: G15, sneaker: 1.5 },
  'D + 처오름 ×2.0': { wave: WC, swell: SC, gust: G15, sneaker: 2.0 },
};

const rank = { safe: 0, caution: 1, danger: 2 };
const pct = (x, n) => `${Math.round((100 * x) / n)}%`.padStart(4);
console.log('후보(A~F는 처오름 요인 없음)'.padEnd(26), '사고 주의+  사고 위험 | 겨울 정오 안전 주의 위험 | 여름 정오 안전 위험 | 사고별 등급');
for (const [name, bp] of Object.entries(CANDIDATES)) {
  constants.BREAKPOINTS.wave = bp.wave;
  constants.BREAKPOINTS.swell = bp.swell;
  constants.BREAKPOINTS.gust = bp.gust;
  // 스니커(처오름) 요인: 후보에 sneaker가 없으면 끈다(유형 목록을 비움)
  constants.SNEAKER.types = bp.sneaker ? SNEAKER0.types : [];
  constants.SNEAKER.extremeFactor = bp.sneaker ?? SNEAKER0.extremeFactor;
  const inc = incidents.map((s) => risk.computeHourlyRisk(s.c, s.profile, s.tin, s.live));
  const cnt = { winter: [0, 0, 0], summer: [0, 0, 0] };
  for (const s of control) cnt[s.season][rank[risk.computeHourlyRisk(s.c, s.profile, s.tin, s.live).grade]]++;
  const wN = cnt.winter.reduce((a, b) => a + b), sN = cnt.summer.reduce((a, b) => a + b);
  const cautionPlus = inc.filter((r) => rank[r.grade] >= 1).length, danger = inc.filter((r) => r.grade === 'danger').length;
  console.log(
    name.padEnd(26),
    `${cautionPlus}/${inc.length}`.padStart(8), `${danger}/${inc.length}`.padStart(10), '|',
    pct(cnt.winter[0], wN), pct(cnt.winter[1], wN), pct(cnt.winter[2], wN), '|', pct(cnt.summer[0], sN), pct(cnt.summer[2], sN), '|',
    inc.map((r, i) => `${incidents[i].id.split('-').slice(0, 2).join('-')}:${r.grade[0]}${r.score}`).join(' '),
  );
}
constants.BREAKPOINTS.wave = ORIGINAL.wave;
constants.BREAKPOINTS.swell = ORIGINAL.swell;
constants.BREAKPOINTS.gust = ORIGINAL.gust;
Object.assign(constants.SNEAKER, SNEAKER0);
