import type { Map as MapLibreMap } from 'maplibre-gl';
import type { OceanCurrent } from './currents';

type Vector = { east: number; north: number };
type Bounds = { west: number; east: number; south: number; north: number };
const radians = Math.PI / 180;

/** 네 모서리에 모두 예보가 있는 해상 셀 안에서만 동·북 성분을 보간한다. */
export function createCurrentField(samples: OceanCurrent[]) {
  const axis = (values: number[]) => [...new Set(values)].sort((a, b) => a - b);
  const xs = axis(samples.map(p => p.lng));
  const ys = axis(samples.map(p => p.lat));
  if (xs.length < 2 || ys.length < 2) return null;
  const vectors: (Vector | undefined)[][] = ys.map(() => []);
  for (const sample of samples) {
    const angle = (sample.direction ?? 0) * radians;
    vectors[ys.indexOf(sample.lat)][xs.indexOf(sample.lng)] = {
      east: sample.speed * Math.sin(angle), north: sample.speed * Math.cos(angle),
    };
  }
  const bounds: Bounds = { west: xs[0], east: xs[xs.length - 1], south: ys[0], north: ys[ys.length - 1] };
  function velocity(lng: number, lat: number): Vector | null {
    if (lng < bounds.west || lat < bounds.south || lng > bounds.east || lat > bounds.north) return null;
    const x = xs.findIndex((value, i) => i > 0 && value >= lng) - 1;
    const y = ys.findIndex((value, i) => i > 0 && value >= lat) - 1;
    const a = vectors[y][x], b = vectors[y][x + 1];
    const c = vectors[y + 1][x], d = vectors[y + 1][x + 1];
    if (!a || !b || !c || !d) return null;
    const u = (lng - xs[x]) / (xs[x + 1] - xs[x]);
    const v = (lat - ys[y]) / (ys[y + 1] - ys[y]);
    const mix = (k: keyof Vector) =>
      (1 - v) * ((1 - u) * a[k] + u * b[k]) + v * ((1 - u) * c[k] + u * d[k]);
    return { east: mix('east'), north: mix('north') };
  }
  return { bounds, velocity };
}

export function startCurrentParticles(map: MapLibreMap, getField: () => ReturnType<typeof createCurrentField>) {
  const canvas = document.createElement('canvas');
  canvas.className = 'current-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  const base = map.getCanvas();
  base.parentElement?.appendChild(canvas);
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  type Particle = { lng: number; lat: number; life: number };
  const particles: Particle[] = [];
  let raf = 0;
  let last = 0;
  const fit = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(base.clientWidth * ratio);
    canvas.height = Math.round(base.clientHeight * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  };
  const reseed = () => { particles.length = 0; };
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (now - last < 32) return;
    const dt = Math.min((now - last) / 1000, 0.08);
    last = now;
    ctx.clearRect(0, 0, base.clientWidth, base.clientHeight);
    const field = getField();
    if (!field) return;
    const view = map.getBounds();
    const west = Math.max(view.getWest(), field.bounds.west), east = Math.min(view.getEast(), field.bounds.east);
    const south = Math.max(view.getSouth(), field.bounds.south), north = Math.min(view.getNorth(), field.bounds.north);
    if (west >= east || south >= north) return;
    const spawn = (): Particle => ({
      lng: west + Math.random() * (east - west),
      lat: south + Math.random() * (north - south),
      life: 1 + Math.random() * 4,
    });
    while (particles.length < 150) particles.push(spawn());
    // 같은 배율에서 이동 거리는 예보 유속에 비례한다. 방향은 지리 좌표에서 계산해 지도 회전도 따른다.
    const degreesPerPixel = 360 / (512 * 2 ** map.getZoom());
    const scale = degreesPerPixel * 38;
    ctx.beginPath();
    ctx.lineCap = 'round';
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const flow = field.velocity(p.lng, p.lat);
      p.life -= dt;
      if (!flow || p.life <= 0) {
        particles[i] = spawn();
        continue;
      }
      if (Math.hypot(flow.east, flow.north) < 0.0001) continue;
      const dx = flow.east * scale, dy = flow.north * scale * Math.cos(p.lat * radians);
      const tail = map.project([p.lng, p.lat]);
      const nextLng = p.lng + dx * dt, nextLat = p.lat + dy * dt;
      const headLng = nextLng + dx * 0.22, headLat = nextLat + dy * 0.22;
      if (!field.velocity(headLng, headLat)) {
        particles[i] = spawn();
        continue;
      }
      const head = map.project([headLng, headLat]);
      ctx.moveTo(tail.x, tail.y);
      ctx.lineTo(head.x, head.y);
      p.lng = nextLng;
      p.lat = nextLat;
    }
    ctx.strokeStyle = 'rgba(0, 65, 77, .8)';
    ctx.lineWidth = 3.8;
    ctx.stroke();
    ctx.strokeStyle = '#61f4e4';
    ctx.lineWidth = 2;
    ctx.stroke();
  };
  const syncMotion = () => {
    cancelAnimationFrame(raf);
    ctx.clearRect(0, 0, base.clientWidth, base.clientHeight);
    if (!motion.matches && !document.hidden) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };
  fit();
  syncMotion();
  map.on('moveend', reseed);
  map.on('resize', fit);
  motion.addEventListener('change', syncMotion);
  document.addEventListener('visibilitychange', syncMotion);
  return () => {
    cancelAnimationFrame(raf);
    map.off('moveend', reseed);
    map.off('resize', fit);
    motion.removeEventListener('change', syncMotion);
    document.removeEventListener('visibilitychange', syncMotion);
    canvas.remove();
  };
}
