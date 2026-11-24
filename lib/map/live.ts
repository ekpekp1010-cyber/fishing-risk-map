// 실시간 레이어용 데이터: 바람, 파고, 기온의 현재 값을 격자로 받아, 바람은 흐르는 입자로 파고와 기온은 색으로 그린다.
// 출처는 Open-Meteo(키 불필요, 무료 사용은 비상업 용도). 브라우저에서 직접 부르며 15분 동안 다시 부르지 않는다.
// 운영 단계에서는 개발자 A의 서버가 모아 둔 값을 받도록 바꾼다(docs/api-contract.md 요청 참고).

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
  /** 지상 2 m 기온(°C) */
  temp: number[][];
  /** 체감 온도(°C). 바람과 습도를 반영한 값 */
  feels: number[][];
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
    fetch(
      `https://api.open-meteo.com/v1/forecast?${query}&current=wind_speed_10m,wind_direction_10m,temperature_2m,apparent_temperature&wind_speed_unit=ms`,
    ),
    fetch(`https://marine-api.open-meteo.com/v1/marine?${query}&current=wave_height`).catch(() => null),
  ]);
  if (!windRes.ok) throw new Error(`wind request failed: ${windRes.status}`);
  const wind = (await windRes.json()) as Array<{
    /** 지점의 해발 고도(m). 바다는 0이다. 파고를 바다 칸에만 칠하는 데 쓴다. */
    elevation?: number;
    current: {
      time: string;
      wind_speed_10m: number;
      wind_direction_10m: number;
      temperature_2m: number;
      apparent_temperature: number;
    };
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
    temp: rows((i) => wind[i].current.temperature_2m),
    feels: rows((i) => wind[i].current.apparent_temperature),
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

/** 격자 사이를 부드럽게 잇는 함수를 돌려준다. 지점이 범위 밖이면 null. */
function mixerAt(grid: LiveGrid, lng: number, lat: number): ((g: number[][]) => number) | null {
  const { lngs, lats } = grid;
  const fx = (lng - lngs[0]) / (lngs[1] - lngs[0]);
  const fy = (lat - lats[0]) / (lats[1] - lats[0]);
  if (fx < 0 || fy < 0 || fx > lngs.length - 1 || fy > lats.length - 1) return null;
  const x0 = Math.min(Math.floor(fx), lngs.length - 2);
  const y0 = Math.min(Math.floor(fy), lats.length - 2);
  const tx = fx - x0;
  const ty = fy - y0;
  return (g) =>
    g[y0][x0] * (1 - tx) * (1 - ty) + g[y0][x0 + 1] * tx * (1 - ty) + g[y0 + 1][x0] * (1 - tx) * ty + g[y0 + 1][x0 + 1] * tx * ty;
}

/** 격자 사이를 부드럽게 이어 한 지점의 바람을 구한다. 범위 밖이면 null. */
export function sampleWind(grid: LiveGrid, lng: number, lat: number): { u: number; v: number; speed: number } | null {
  const mix = mixerAt(grid, lng, lat);
  if (!mix) return null;
  const u = mix(grid.u);
  const v = mix(grid.v);
  return { u, v, speed: Math.hypot(u, v) };
}

/** 한 지점의 요약: 풍속, 기온, 체감 온도와 가장 가까운 바다 칸의 파고. */
export function liveSummary(grid: LiveGrid, lng: number, lat: number) {
  const wind = sampleWind(grid, lng, lat);
  const mix = mixerAt(grid, lng, lat);
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
  return {
    windSpeed: wind?.speed ?? null,
    waveHeight: wave as number | null,
    temperature: mix ? mix(grid.temp) : null,
    feelsLike: mix ? mix(grid.feels) : null,
    observedAt: grid.observedAt,
  };
}

const hexToRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** 색 단계 사이를 이어 값에 맞는 색을 구한다. 범위를 벗어나면 양 끝 색이다. */
function colorAt(stops: Array<[number, string]>, value: number): number[] {
  for (let i = 1; i < stops.length; i++) {
    const [v0, c0] = stops[i - 1];
    const [v1, c1] = stops[i];
    if (value <= v1) {
      const t = Math.max(0, (value - v0) / (v1 - v0));
      const a = hexToRgb(c0);
      const b = hexToRgb(c1);
      return a.map((v, k) => v + (b[k] - v) * t);
    }
  }
  return hexToRgb(stops[stops.length - 1][1]);
}

const waveColor = (h: number) => colorAt(WAVE_STOPS, h);

export type ImageCorners = [[number, number], [number, number], [number, number], [number, number]];

/**
 * 파고를 경계선 없이 부드러운 색 그라데이션으로 그리기 위한 그림.
 * 격자 사이를 이어 붙여 칸의 경계가 보이지 않게 하고, 육지에 가까울수록 투명해지게 한다.
 */
export function waveImage(grid: LiveGrid): { url: string; coordinates: ImageCorners } | null {
  const SCALE = 8;
  const cols = grid.lngs.length;
  const rows = grid.lats.length;
  const canvas = document.createElement('canvas');
  canvas.width = (cols - 1) * SCALE + 1;
  canvas.height = (rows - 1) * SCALE + 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const fx = x / SCALE;
      const fy = (canvas.height - 1 - y) / SCALE; // 그림의 첫 줄이 북쪽이다
      const x0 = Math.min(Math.floor(fx), cols - 2);
      const y0 = Math.min(Math.floor(fy), rows - 2);
      const tx = fx - x0;
      const ty = fy - y0;
      const corners: Array<[number, number, number]> = [
        [y0, x0, (1 - tx) * (1 - ty)],
        [y0, x0 + 1, tx * (1 - ty)],
        [y0 + 1, x0, (1 - tx) * ty],
        [y0 + 1, x0 + 1, tx * ty],
      ];
      let sum = 0;
      let weight = 0;
      for (const [r, c, w] of corners) {
        const h = grid.wave[r][c];
        if (h !== null) {
          sum += h * w;
          weight += w;
        }
      }
      if (weight <= 0) continue;
      const [red, green, blue] = waveColor(sum / weight);
      const o = (y * canvas.width + x) * 4;
      img.data[o] = red;
      img.data[o + 1] = green;
      img.data[o + 2] = blue;
      // 바다 칸의 비중이 낮은 곳(해안)은 옅게 해서 육지 쪽으로 자연스럽게 사라지게 한다.
      // 격자가 성겨 해안선 위치를 정확히 알 수 없으므로, 바다 칸과 육지 칸의 중간쯤에서 사라지게 한다.
      img.data[o + 3] = Math.round(255 * Math.min(1, Math.max(0, (weight - 0.5) / 0.35)));
    }
  }
  ctx.putImageData(img, 0, 0);
  const { west, south, east, north } = LIVE.region;
  return {
    url: canvas.toDataURL(),
    coordinates: [
      [west, north],
      [east, north],
      [east, south],
      [west, south],
    ],
  };
}

/**
 * 기온을 경계선 없는 색 그라데이션으로 그리기 위한 그림. 육지와 바다를 모두 칠한다.
 * 받아 온 범위의 가장자리에서는 옅어지게 해서, 넓게 봤을 때 네모난 경계가 보이지 않게 한다.
 */
export function tempImage(grid: LiveGrid): { url: string; coordinates: ImageCorners } | null {
  const SCALE = 8;
  const cols = grid.lngs.length;
  const rows = grid.lats.length;
  const canvas = document.createElement('canvas');
  canvas.width = (cols - 1) * SCALE + 1;
  canvas.height = (rows - 1) * SCALE + 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const fx = x / SCALE;
      const fy = (canvas.height - 1 - y) / SCALE; // 그림의 첫 줄이 북쪽이다
      const x0 = Math.min(Math.floor(fx), cols - 2);
      const y0 = Math.min(Math.floor(fy), rows - 2);
      const tx = fx - x0;
      const ty = fy - y0;
      const t =
        grid.temp[y0][x0] * (1 - tx) * (1 - ty) +
        grid.temp[y0][x0 + 1] * tx * (1 - ty) +
        grid.temp[y0 + 1][x0] * (1 - tx) * ty +
        grid.temp[y0 + 1][x0 + 1] * tx * ty;
      const [red, green, blue] = colorAt(TEMP_STOPS, t);
      const edge = Math.min(x, y, canvas.width - 1 - x, canvas.height - 1 - y);
      const o = (y * canvas.width + x) * 4;
      img.data[o] = red;
      img.data[o + 1] = green;
      img.data[o + 2] = blue;
      img.data[o + 3] = Math.round(255 * Math.min(1, edge / SCALE));
    }
  }
  ctx.putImageData(img, 0, 0);
  const { west, south, east, north } = LIVE.region;
  return {
    url: canvas.toDataURL(),
    coordinates: [
      [west, north],
      [east, north],
      [east, south],
      [west, south],
    ],
  };
}

/** 격자 지점마다 기온 숫자를 적기 위한 점들. 가장자리 줄은 색이 옅어지는 곳이라 뺀다. */
export function tempLabels(grid: LiveGrid) {
  const features = [];
  for (let r = 1; r < grid.lats.length - 1; r++) {
    for (let c = 1; c < grid.lngs.length - 1; c++) {
      features.push({
        type: 'Feature' as const,
        properties: { label: `${Math.round(grid.temp[r][c])}°` },
        geometry: { type: 'Point' as const, coordinates: [grid.lngs[c], grid.lats[r]] },
      });
    }
  }
  return { type: 'FeatureCollection' as const, features };
}

/** 기온 색 단계(°C → 색). 추운 쪽은 보라·파랑, 더운 쪽은 주황·빨강이다. 지도 레이어와 범례가 함께 쓴다. */
export const TEMP_STOPS: Array<[number, string]> = [
  [-10, '#6b3fa0'],
  [0, '#3b6fd4'],
  [5, '#35a7c9'],
  [10, '#4fbf8b'],
  [15, '#b9d44a'],
  [20, '#f4c542'],
  [25, '#ef8a3a'],
  [30, '#d9432f'],
  [35, '#8f1d3f'],
];

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
