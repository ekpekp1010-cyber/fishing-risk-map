// 게이트 2: 과거 사고 지점·시각을 실제 위험도 계산식(lib/risk)으로 다시 계산한다.
//
//   (pipeline/에서) python -m fishrisk.incidents     → out/incidents/terrain.json (사고 지점 V)
//   (저장소 루트에서) node pipeline/validation/gate2.mjs
//
// 과거 자료:
//   날씨   Open-Meteo Historical(ERA5) archive-api — 풍속·돌풍·강수·날씨 코드·체감온도·낮밤
//   파랑   2022년 이후는 Open-Meteo Marine 기본 모델(너울 포함),
//          그 이전은 ERA5 해양 모델(0.5°, 너울 변수 없음 → 너울 파고=유의파고, 너울 주기=파랑 최대 주기)
//   조위   NOAA 9435380 시간별 실측(hourly_height, 평균해면 기준) — 운영의 '보정 해수면'과 같은 자리
//   경보   IEM VTEC 기록, 링컨 카운티 해안 구역 ORZ002(2024년까지)·ORZ102·ORZ103
// 판정: 사고 시각의 등급이 caution 이상이면 재현. 시각이 불확실하면 낮 시간대 창의 중앙 시각.
// 결과: pipeline/validation/gate2_results.md, pipeline/out/incidents/results.json

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'pipeline/out/incidents');
// 컴파일 결과는 lint 대상이 아닌 node_modules/.cache에 둔다.
const CJS = join(ROOT, 'node_modules/.cache/fishrisk-risk-cjs');

// lib/risk를 CommonJS로 컴파일해 그대로 쓴다(운영 코드와 같은 계산).
if (!existsSync(join(CJS, 'risk/index.js'))) {
  execFileSync(
    process.execPath,
    [join(ROOT, 'node_modules/typescript/bin/tsc'), join(ROOT, 'lib/risk/index.ts'),
      '--outDir', CJS, '--rootDir', join(ROOT, 'lib'), '--module', 'commonjs', '--target', 'es2020',
      '--skipLibCheck', '--esModuleInterop'],
    { stdio: 'inherit' },
  );
}
const require = createRequire(import.meta.url);
const { computeHourlyRisk } = require(join(CJS, 'risk/index.js'));

const HOUR = 3_600_000;
const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const getJson = async (url, headers = {}) => {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { headers: { 'User-Agent': 'fishing-risk-map-validation', ...headers } });
    if (r.ok) return r.json();
    await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
  }
  throw new Error(`fetch 실패: ${url}`);
};

/** 사고 시각을 확정할 수 없을 때 보는 시간대(UTC 시각 목록) */
function window(inc) {
  const t = Date.parse(inc.utc_hour);
  const span = inc.time_certainty === 'day_only' ? 5 : inc.time_certainty === 'afternoon_only' ? 3 : 1;
  return Array.from({ length: span * 2 + 1 }, (_, i) => iso(t + (i - span) * HOUR));
}

async function history(inc) {
  const lat = Number(inc.lat), lng = Number(inc.lng);
  const hours = window(inc);
  const start = day(Date.parse(hours[0])), end = day(Date.parse(hours.at(-1)));
  const year = Number(inc.date_local.slice(0, 4));

  const wx = await getJson(
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&start_date=${start}&end_date=${end}` +
      '&hourly=wind_speed_10m,wind_gusts_10m,precipitation,weather_code,apparent_temperature,is_day&wind_speed_unit=ms&timezone=UTC',
  );
  let marine, waveSource;
  if (year >= 2022) {
    marine = await getJson(
      `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lng}&start_date=${start}&end_date=${end}` +
        '&hourly=wave_height,swell_wave_height,swell_wave_period&timezone=UTC',
    );
    waveSource = `Open-Meteo Marine (${marine.latitude}, ${marine.longitude})`;
  } else {
    // ERA5 해양 0.5° 격자의 바다 쪽 점
    const mlat = Math.round(lat * 2) / 2, mlng = -124.5;
    marine = await getJson(
      `https://marine-api.open-meteo.com/v1/marine?latitude=${mlat}&longitude=${mlng}&start_date=${start}&end_date=${end}` +
        '&hourly=wave_height,wave_peak_period&models=era5_ocean&timezone=UTC',
    );
    waveSource = `ERA5 해양 (${marine.latitude}, ${marine.longitude})`;
  }
  const noaaBase = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?station=9435380&datum=MSL&units=metric' +
    `&time_zone=gmt&format=json&application=fishing-risk-map&begin_date=${start.replaceAll('-', '')}&end_date=${end.replaceAll('-', '')}`;
  let tide = await getJson(`${noaaBase}&product=hourly_height`);
  if (!tide.data) tide = await getJson(`${noaaBase}&product=water_level`);

  const alerts = [];
  for (const ugc of ['ORZ002', 'ORZ102', 'ORZ103']) {
    const a = await getJson(
      `https://mesonet.agron.iastate.edu/json/vtec_events_byugc.php?ugc=${ugc}` +
        `&sdate=${day(Date.parse(start) - 2 * 24 * HOUR)}&edate=${day(Date.parse(end) + 24 * HOUR)}`,
    );
    for (const e of a.events ?? []) alerts.push({ name: e.name, issue: e.issue, expire: e.expire, ugc });
  }

  const at = (series, key, t) => {
    const i = series.hourly.time.indexOf(t.slice(0, 16));
    return i < 0 ? null : series.hourly[key]?.[i] ?? null;
  };
  const tideAt = (t) => {
    const s = t.slice(0, 16).replace('T', ' ');
    const r = (tide.data ?? []).find((x) => x.t === s);
    return r && r.v !== '' ? Number(r.v) : null;
  };
  const conditions = hours.map((t) => {
    const hs = at(marine, 'wave_height', t);
    const isDay = at(wx, 'is_day', t);
    return {
      time: t,
      waveHeightM: hs,
      swellHeightM: year >= 2022 ? at(marine, 'swell_wave_height', t) : hs,
      swellPeriodS: year >= 2022 ? at(marine, 'swell_wave_period', t) : at(marine, 'wave_peak_period', t),
      windSpeedMs: at(wx, 'wind_speed_10m', t),
      windGustMs: at(wx, 'wind_gusts_10m', t),
      precipitationMm: at(wx, 'precipitation', t),
      weatherCode: at(wx, 'weather_code', t),
      seaLevelM: tideAt(t),
      riverRatio: null,
      apparentTempC: at(wx, 'apparent_temperature', t),
      isDark: isDay === null ? false : isDay === 0,
      nextHighTideClock: null,
    };
  });
  return { hours, conditions, alerts, waveSource };
}

const GRADE_RANK = { safe: 0, caution: 1, danger: 2 };

async function main() {
  const terrain = JSON.parse(readFileSync(join(OUT, 'terrain.json'), 'utf8'));
  const results = [];
  for (const t of terrain) {
    const inc = t.incident;
    const h = await history(inc);
    const exposure = t.factors.find((f) => f.code === 'wave_exposure');
    const profile = {
      type: inc.type,
      elevationM: t.elevation_m,
      egressMinElevationM: t.egress_min_elevation_m,
      slopeDeg: t.slope_deg,
      waveExposure: exposure ? exposure.score / 100 : 1,
    };
    const tin = { score: t.score, confidence: t.confidence, factors: t.factors.map(({ code, label, score }) => ({ code, label, score })) };
    const rows = h.conditions.map((c) => {
      const live = h.alerts
        .filter((a) => Date.parse(a.issue) <= Date.parse(c.time) && Date.parse(c.time) < Date.parse(a.expire))
        .map((a) => ({ source: 'NWS', event: a.name, headline: `${a.name} 발효 중`, expires: a.expire }));
      const withAlerts = computeHourlyRisk(c, profile, tin, live);
      const without = computeHourlyRisk(c, profile, tin, []);
      return { time: c.time, conditions: c, alerts: live.map((a) => a.event), withAlerts, without };
    });
    const target = rows[Math.floor(rows.length / 2)];
    const reproduced = GRADE_RANK[target.withAlerts.grade] >= 1;
    const reproducedNoAlert = GRADE_RANK[target.without.grade] >= 1;
    results.push({ id: inc.id, place: inc.place, type: inc.type, utc_hour: inc.utc_hour, time_certainty: inc.time_certainty,
      V: t.score, waveSource: h.waveSource, target, window: rows, reproduced, reproducedNoAlert });
    const c = target.conditions;
    console.log(
      `${inc.id.padEnd(26)} ${target.withAlerts.grade.padEnd(7)} R ${String(target.withAlerts.score).padStart(3)}` +
        ` (경보 빼면 ${target.without.grade} ${target.without.score}) | 파고 ${c.waveHeightM} m 주기 ${c.swellPeriodS} s` +
        ` 돌풍 ${c.windGustMs} m/s 조위 ${c.seaLevelM} m | 경보 ${target.alerts.join(', ') || '없음'}`,
    );
  }

  const n = results.length;
  const hit = results.filter((r) => r.reproduced).length;
  const hitNo = results.filter((r) => r.reproducedNoAlert).length;
  const pass = hit / n >= 0.8;
  console.log(`\n재현 ${hit}/${n} (${Math.round((100 * hit) / n)}%), 경보 빼고 ${hitNo}/${n} → 게이트 2 ${pass ? '통과' : '미통과'}(기준 80%)`);

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  const md = [
    '# 게이트 2 결과: 과거 사고 재계산',
    '',
    `실행: ${new Date().toISOString()} · 계산식: lib/risk (운영과 같음) · 판정: 사고 시각 등급이 caution 이상이면 재현`,
    '',
    `**재현 ${hit}/${n} (${Math.round((100 * hit) / n)}%) → ${pass ? '통과' : '미통과'}** (기준 80%). 경보를 빼고 계산하면 ${hitNo}/${n}.`,
    '',
    '| 사고 | 시각(UTC) | 시각 확실성 | V | 등급(경보 포함) | R | 경보 빼면 | 파고 | 주기 | 돌풍 | 조위 | 발효 경보 | 원인 상위 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...results.map((r) => {
      const c = r.target.conditions;
      return `| ${r.place} | ${r.utc_hour.slice(0, 13)} | ${r.time_certainty} | ${r.V} | ${r.target.withAlerts.grade} | ${r.target.withAlerts.score} | ` +
        `${r.target.without.grade} ${r.target.without.score} | ${c.waveHeightM ?? '-'} m | ${c.swellPeriodS ?? '-'} s | ${c.windGustMs ?? '-'} m/s | ` +
        `${c.seaLevelM ?? '-'} m | ${r.target.alerts.join(', ') || '없음'} | ${r.target.without.causes.map((x) => x.label).join(' / ')} |`;
    }),
    '',
    '시간대 창(불확실한 시각) 안의 등급:',
    '',
    ...results.map((r) => `- ${r.id}: ${r.window.map((w) => `${w.time.slice(11, 13)}시 ${w.withAlerts.grade}`).join(', ')}`),
    '',
    '파랑 자료: ' + [...new Set(results.map((r) => r.waveSource))].join(' · '),
    '',
  ].join('\n');
  writeFileSync(join(ROOT, 'pipeline/validation/gate2_results.md'), md);
}

await main();
