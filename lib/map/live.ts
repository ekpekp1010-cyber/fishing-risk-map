// 실시간 레이어용 데이터: 바람과 파고의 현재 값을 격자로 받아, 바람은 흐르는 입자로 파고는 색 칸으로 그린다.
// 출처는 Open-Meteo(키 불필요, 무료 사용은 비상업 용도). 브라우저에서 직접 부르며 15분 동안 다시 부르지 않는다.
// 운영 단계에서는 개발자 A의 서버가 모아 둔 값을 받도록 바꾼다(docs/api-contract.md 요청 참고).

import type { FeatureCollection, Polygon } from 'geojson';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { LIVE } from './config';

export interface LiveGrid {
  lngs: number[];
  lats: number[];
  /** [위도 순번][경도 순번]. u는 동쪽, v는 북쪽으로 부는 성분(m/s) */
  u: number[][];
  v: number[][];
  speed: number[][];
  /** 파고(m). 육지는 null */
  wave: (number | null)[][];
  /** 관측·예보 기준 시각(UTC) */
  observedAt: string;
}

const TTL_MS = 15 * 60 * 1000;
let cached: { at: number; grid: LiveGrid } | null = null;
let pending: Promise<LiveGrid> | null = null;

const range = (from: number, to: number, step: number) => {
  const out: number[] = [];
  for (let x = from; x <= to + 1e-9; x += step) out.push(Number(x.toFixed(4)));
  return out;
};

async function fetchGrid(): Promise<LiveGrid> {
  const { west, south, east, north, step } = LIVE.region;
  const lngs = range(west, east, step);
  const lats = range(south, north, step);
  const points = lats.flatMap((lat) => lngs.map((lng) => ({ lat, lng })));
  const query = `latitude=${points.map((p) => p.lat).join(',')}&longitude=${points.map((p) => p.lng).join(',')}`;

  const [windRes, waveRes] = await Promise.all([
    fetch(`https://api.open-meteo.com/v1/forecast?${query}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms`),
    fetch(`https://marine-api.open-meteo.com/v1/marine?${query}&current=wave_height`).catch(() => null),
  ]);
  if (!windRes.ok) throw new Error(`wind request failed: ${windRes.status}`);
  const wind = (await windRes.json()) as Array<{
    /** 지점의 해발 고도(m). 바다는 0이다. 파고를 바다 칸에만 칠하는 데 쓴다. */
    elevation?: number;
    current: { time: string; wind_speed_10m: number; wind_direction_10m: number };
  }>;
  const waves =
    waveRes && waveRes.ok ? ((await waveRes.json()) as Array<{ current?: { wave_height: number | null } }>) : null;

  const rows = <T,>(pick: (i: number) => T) => lats.map((_, r) => lngs.map((_, c) => pick(r * lngs.length + c)));
  const toward = (i: number) => ((wind[i].current.wind_direction_10m + 180) * Math.PI) / 180;
  return {
    lngs,
    lats,
    // 풍향은 "불어오는 방향"이므로 180도 돌려 "불어가는 방향"으로 바꾼다.
    u: rows((i) => wind[i].current.wind_speed_10m * Math.sin(toward(i))),
    v: rows((i) => wind[i].current.wind_speed_10m * Math.cos(toward(i))),
    speed: rows((i) => wind[i].current.wind_speed_10m),
    // 해양 예보는 육지 지점에도 가까운 바다 값을 돌려주므로, 고도가 0보다 큰 칸은 비운다.
    wave: rows((i) => ((wind[i].elevation ?? 0) > 0 ? null : (waves?.[i]?.current?.wave_height ?? null))),
    observedAt: `${wind[0].current.time}:00Z`,
  };
}

export function loadLiveGrid(): Promise<LiveGrid> {
  if (cached && Date.now() - cached.at < TTL_MS) return Promise.resolve(cached.grid);
  pending ??= fetchGrid()
    .then((grid) => {
      cached = { at: Date.now(), grid };
      return grid;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** 격자 사이를 부드럽게 이어 한 지점의 바람을 구한다. 범위 밖이면 null. */
export function sampleWind(grid: LiveGrid, lng: number, lat: number): { u: number; v: number; speed: number } | null {
  const { lngs, lats } = grid;
  const fx = (lng - lngs[0]) / (lngs[1] - lngs[0]);
  const fy = (lat - lats[0]) / (lats[1] - lats[0]);
  if (fx < 0 || fy < 0 || fx > lngs.length - 1 || fy > lats.length - 1) return null;
  const x0 = Math.min(Math.floor(fx), lngs.length - 2);
  const y0 = Math.min(Math.floor(fy), lats.length - 2);
  const tx = fx - x0;
  const ty = fy - y0;
  const mix = (g: number[][]) =>
    g[y0][x0] * (1 - tx) * (1 - ty) + g[y0][x0 + 1] * tx * (1 - ty) + g[y0 + 1][x0] * (1 - tx) * ty + g[y0 + 1][x0 + 1] * tx * ty;
  const u = mix(grid.u);
  const v = mix(grid.v);
  return { u, v, speed: Math.hypot(u, v) };
}

/** 한 지점의 요약: 풍속과 가장 가까운 바다 칸의 파고. */
export function liveSummary(grid: LiveGrid, lng: number, lat: number) {
  const wind = sampleWind(grid, lng, lat);
  let wave: number | null = null;
  let best = Infinity;
  grid.lats.forEach((gLat, r) =>
    grid.lngs.forEach((gLng, c) => {
      const h = grid.wave[r][c];
      const d = Math.hypot(gLat - lat, (gLng - lng) * Math.cos((lat * Math.PI) / 180));
      if (h !== null && d < best) {
        best = d;
        wave = h;
      }
    }),
  );
  return { windSpeed: wind?.speed ?? null, waveHeight: wave as number | null, observedAt: grid.observedAt };
}

/** 파고를 색 칸으로 그리기 위한 도형. 육지 칸은 뺀다. */
export function waveCells(grid: LiveGrid): FeatureCollection<Polygon> {
  const half = LIVE.region.step / 2;
  const features: FeatureCollection<Polygon>['features'] = [];
  grid.lats.forEach((lat, r) =>
    grid.lngs.forEach((lng, c) => {
      const h = grid.wave[r][c];
      if (h === null) return;
      features.push({
        type: 'Feature',
        properties: { h },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [lng - half, lat - half],
              [lng + half, lat - half],
              [lng + half, lat + half],
              [lng - half, lat + half],
              [lng - half, lat - half],
            ],
          ],
        },
      });
    }),
  );
  return { type: 'FeatureCollection', features };
}

/** 파고 색 단계(m → 색). 지도 레이어와 범례가 함께 쓴다. */
export const WAVE_STOPS: Array<[number, string]> = [
  [0, '#2b6cb0'],
  [1, '#38b2ac'],
  [2, '#68d391'],
  [3, '#f6e05e'],
  [4, '#ed8936'],
  [6, '#c53030'],
];

/**
 * 바람을 따라 흐르는 입자를 지도 위에 그린다. 멈추는 함수를 돌려준다.
 * 입자는 위경도로 위치를 갖고, 매 장면마다 그 지점의 바람 방향으로 조금씩 움직인다.
 */
export function startWindParticles(map: MapLibreMap, grid: LiveGrid): () => void {
  const canvas = document.createElement('canvas');
  canvas.className = 'wind-canvas';
  const mapCanvas = map.getCanvas();
  mapCanvas.parentElement?.insertBefore(canvas, mapCanvas.nextSibling);
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => canvas.remove();

  const COUNT = 420;
  const MAX_AGE = 90;
  interface Particle {
    lng: number;
    lat: number;
    age: number;
  }
  const spawn = (age: number): Particle => {
    const b = map.getBounds();
    const w = Math.max(b.getWest(), LIVE.region.west);
    const e = Math.min(b.getEast(), LIVE.region.east);
    const s = Math.max(b.getSouth(), LIVE.region.south);
    const n = Math.min(b.getNorth(), LIVE.region.north);
    return { lng: w + Math.random() * Math.max(e - w, 1e-4), lat: s + Math.random() * Math.max(n - s, 1e-4), age };
  };
  const seed = () => Array.from({ length: COUNT }, () => spawn(Math.floor(Math.random() * MAX_AGE)));
  let particles = seed();

  const fit = () => {
    canvas.width = mapCanvas.clientWidth;
    canvas.height = mapCanvas.clientHeight;
  };
  const reset = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles = seed();
  };
  fit();

  let raf = 0;
  let last = 0;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (now - last < 33) return;
    last = now;
    // 이전 장면을 조금 흐리게 남겨 꼬리처럼 보이게 한다.
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const wind = sampleWind(grid, p.lng, p.lat);
      if (!wind || p.age > MAX_AGE) {
        particles[i] = spawn(0);
        continue;
      }
      const a = map.project([p.lng, p.lat]);
      const k = 0.002 / Math.max(wind.speed, 0.5);
      const b = map.project([p.lng + (wind.u * k) / Math.cos((p.lat * Math.PI) / 180), p.lat + wind.v * k]);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const stepPx = Math.min(5, 0.6 + wind.speed * 0.28);
      const nx = a.x + (dx / len) * stepPx;
      const ny = a.y + (dy / len) * stepPx;
      if (nx < 0 || ny < 0 || nx > canvas.width || ny > canvas.height) {
        particles[i] = spawn(0);
        continue;
      }
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(nx, ny);
      const next = map.unproject([nx, ny]);
      p.lng = next.lng;
      p.lat = next.lat;
      p.age++;
    }
    ctx.stroke();
  };

  map.on('move', reset);
  map.on('resize', fit);
  raf = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(raf);
    map.off('move', reset);
    map.off('resize', fit);
    canvas.remove();
  };
}
