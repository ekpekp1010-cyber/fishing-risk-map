// 게이트 2 대조군: 사고 지점 6곳에서 2023~2025년 매일 현지 정오(20시 UTC, 겨울 기준)의 등급 분포.
// 사고 시각에만 위험이 나오고 평소에는 낮게 나오는지(변별력) 본다.
//
//   node pipeline/validation/control.mjs     (gate2.mjs를 한 번 돌려 node_modules/.cache/fishrisk-risk-cjs가 있어야 한다)
// 결과: pipeline/validation/control_results.md

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const { computeHourlyRisk } = require(join(ROOT, 'node_modules/.cache/fishrisk-risk-cjs/risk/index.js'));

const YEARS = [2023, 2024, 2025];
const START = `${YEARS[0]}-01-01`, END = `${YEARS.at(-1)}-12-31`;
const UGCS = ['ORZ002', 'ORZ102', 'ORZ103'];
const getJson = async (url) => {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { headers: { 'User-Agent': 'fishing-risk-map-validation' } });
    if (r.ok) return r.json();
    await new Promise((res) => setTimeout(res, 3000 * (i + 1)));
  }
  throw new Error(`fetch 실패: ${url}`);
};

// 조위와 경보는 지점과 무관하니 한 번만 받는다.
const tide = new Map();
for (const y of YEARS) {
  const d = await getJson(
    'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?station=9435380&datum=MSL&units=metric&time_zone=gmt' +
      `&format=json&application=fishing-risk-map&product=hourly_height&begin_date=${y}0101&end_date=${y}1231`,
  );
  for (const r of d.data ?? []) if (r.v !== '') tide.set(r.t.replace(' ', 'T') + ':00Z', Number(r.v));
}
const alerts = [];
for (const ugc of UGCS) {
  const a = await getJson(`https://mesonet.agron.iastate.edu/json/vtec_events_byugc.php?ugc=${ugc}&sdate=${START}&edate=${END}`);
  for (const e of a.events ?? []) alerts.push({ name: e.name, issue: Date.parse(e.issue), expire: Date.parse(e.expire) });
}

const terrain = JSON.parse(readFileSync(join(ROOT, 'pipeline/out/incidents/terrain.json'), 'utf8'));
const season = (t) => ([10, 11, 12, 1, 2, 3, 4].includes(new Date(t).getUTCMonth() + 1) ? 'winter' : 'summer');
const out = [];
const samples = []; // sweep.mjs가 임계값을 바꿔 다시 계산할 때 쓴다
for (const t of terrain) {
  const { lat, lng } = t.snapped;
  const base = `latitude=${lat}&longitude=${lng}&start_date=${START}&end_date=${END}&timezone=UTC`;
  const wx = await getJson(`https://archive-api.open-meteo.com/v1/archive?${base}` +
    '&hourly=wind_speed_10m,wind_gusts_10m,precipitation,weather_code,apparent_temperature,is_day&wind_speed_unit=ms');
  const mr = await getJson(`https://marine-api.open-meteo.com/v1/marine?${base}&hourly=wave_height,swell_wave_height,swell_wave_period`);
  const wxi = new Map(wx.hourly.time.map((x, i) => [x, i]));
  const mri = new Map(mr.hourly.time.map((x, i) => [x, i]));
  const exposure = t.factors.find((f) => f.code === 'wave_exposure');
  const profile = { type: t.incident.type, elevationM: t.elevation_m, egressMinElevationM: t.egress_min_elevation_m,
    slopeDeg: t.slope_deg, waveExposure: exposure ? exposure.score / 100 : 1 };
  const tin = { score: t.score, confidence: t.confidence, factors: t.factors.map(({ code, label, score }) => ({ code, label, score })) };

  const counts = { winter: { safe: 0, caution: 0, danger: 0, n: 0 }, summer: { safe: 0, caution: 0, danger: 0, n: 0 } };
  const noAlert = { winter: { danger: 0 }, summer: { danger: 0 } };
  for (const key of wx.hourly.time) {
    if (!key.endsWith('T20:00')) continue;
    const time = `${key}:00Z`;
    const i = wxi.get(key), j = mri.get(key);
    if (j === undefined || mr.hourly.wave_height[j] == null) continue;
    const c = {
      time, waveHeightM: mr.hourly.wave_height[j], swellHeightM: mr.hourly.swell_wave_height[j], swellPeriodS: mr.hourly.swell_wave_period[j],
      windSpeedMs: wx.hourly.wind_speed_10m[i], windGustMs: wx.hourly.wind_gusts_10m[i], precipitationMm: wx.hourly.precipitation[i],
      weatherCode: wx.hourly.weather_code[i], seaLevelM: tide.get(time) ?? null, riverRatio: null,
      apparentTempC: wx.hourly.apparent_temperature[i], isDark: wx.hourly.is_day[i] === 0, nextHighTideClock: null,
    };
    const ms = Date.parse(time);
    const live = alerts.filter((a) => a.issue <= ms && ms < a.expire)
      .map((a) => ({ source: 'NWS', event: a.name, headline: a.name, expires: new Date(a.expire).toISOString() }));
    const s = season(time);
    samples.push({ id: t.incident.id, season: s, c, live, profile, tin });
    const g = computeHourlyRisk(c, profile, tin, live).grade;
    counts[s][g]++;
    counts[s].n++;
    if (computeHourlyRisk(c, profile, tin, []).grade === 'danger') noAlert[s].danger++;
  }
  out.push({ id: t.incident.id, V: t.score, counts, noAlert });
  const pct = (x, n) => `${Math.round((100 * x) / n)}%`;
  const w = counts.winter, su = counts.summer;
  console.log(`${t.incident.id.padEnd(26)} V ${String(t.score).padStart(2)} | 10~4월 안전 ${pct(w.safe, w.n)} 주의 ${pct(w.caution, w.n)} 위험 ${pct(w.danger, w.n)}` +
    ` (경보 빼면 위험 ${pct(noAlert.winter.danger, w.n)}) | 5~9월 안전 ${pct(su.safe, su.n)} 주의 ${pct(su.caution, su.n)} 위험 ${pct(su.danger, su.n)}`);
}

writeFileSync(join(ROOT, 'pipeline/out/incidents/control_samples.json'), JSON.stringify(samples));
const pct = (x, n) => `${Math.round((100 * x) / n)}%`;
writeFileSync(join(ROOT, 'pipeline/validation/control_results.md'), [
  '# 게이트 2 대조군: 사고 지점의 평소 등급',
  '',
  `실행: ${new Date().toISOString()} · 2023~2025년 매일 20시 UTC(현지 정오 무렵) · 운영과 같은 자료(Open-Meteo Marine 기본 모델, ERA5 날씨, NOAA 실측 조위, IEM 경보)`,
  '',
  '| 사고 지점 | V | 10~4월 안전 | 주의 | 위험 | 위험(경보 빼고) | 5~9월 안전 | 주의 | 위험 |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...out.map((r) => {
    const w = r.counts.winter, s = r.counts.summer;
    return `| ${r.id} | ${r.V} | ${pct(w.safe, w.n)} | ${pct(w.caution, w.n)} | ${pct(w.danger, w.n)} | ${pct(r.noAlert.winter.danger, w.n)} | ` +
      `${pct(s.safe, s.n)} | ${pct(s.caution, s.n)} | ${pct(s.danger, s.n)} |`;
  }),
  '',
].join('\n'));
