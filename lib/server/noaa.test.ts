import { describe, expect, it } from 'vitest';
import type { ForecastHourlyRow } from './db-types';
import { applyCorrection, computeSurge, correctedLevel, mergeStation, noaaTime, SURGE_DECAY_HOURS } from './noaa';

const NOW = new Date('2026-11-24T10:05:00Z');

// 08·09·10시 실측, 08~13시 천문조
const obs = [
  { t: '2026-11-24 08:00', v: '1.35' },
  { t: '2026-11-24 08:06', v: '1.36' }, // 정각이 아니면 버린다
  { t: '2026-11-24 09:00', v: '1.26' },
  { t: '2026-11-24 10:00', v: '' }, // 빈 값은 버린다
];
const pred = ['08', '09', '10', '11', '12', '13'].map((h, i) => ({ t: `2026-11-24 ${h}:00`, v: String(0.9 - i * 0.2) }));

describe('noaa', () => {
  it('시각 변환과 정시 병합', () => {
    expect(noaaTime('2026-11-24 09:00')).toBe('2026-11-24T09:00:00Z');
    const rows = mergeStation(obs, pred);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toEqual({ time: '2026-11-24T08:00:00Z', predicted: 0.9, observed: 1.35 });
    expect(rows[2].observed).toBeNull();
  });

  it('해일 성분 = 최근 실측 3시간의 (실측 - 천문조) 평균', () => {
    const s = computeSurge(mergeStation(obs, pred), NOW)!;
    // 08시 1.35-0.9=0.45, 09시 1.26-0.7=0.56 → 0.505
    expect(s.surgeM).toBeCloseTo(0.505);
    expect(s.at).toBe('2026-11-24T09:00:00Z');
    expect(s.hours).toBe(2);
  });

  it('관측이 3시간 넘게 끊기면 보정하지 않는다', () => {
    expect(computeSurge(mergeStation(obs, pred), new Date('2026-11-24T12:30:00Z'))).toBeNull();
    expect(computeSurge(mergeStation([], pred), NOW)).toBeNull();
  });

  it('실측이 있으면 실측, 미래는 천문조 + 줄어드는 해일 성분', () => {
    const rows = mergeStation(obs, pred);
    const s = computeSurge(rows, NOW)!;
    expect(correctedLevel(rows[0], s)).toBe(1.35);
    const lead = 4; // 13시
    expect(correctedLevel(rows[5], s)).toBeCloseTo(-0.1 + 0.505 * Math.exp(-lead / SURGE_DECAY_HOURS));
    expect(correctedLevel(undefined, s)).toBeNull();
  });

  it('예보 행에 보정값을 채우고, 보정할 수 없으면 null', () => {
    const f = { cell_id: 'c', time: '2026-11-24T11:00:00Z', sea_level_m: 0.2, sea_level_corrected_m: 9 } as ForecastHourlyRow;
    const station = mergeStation(obs, pred);
    const [a] = applyCorrection([f], station, computeSurge(station, NOW));
    expect(a.sea_level_corrected_m).toBeCloseTo(0.3 + 0.505 * Math.exp(-2 / SURGE_DECAY_HOURS));
    expect(applyCorrection([f], station, null)[0].sea_level_corrected_m).toBeNull();
    expect(applyCorrection([{ ...f, time: '2026-11-30T00:00:00Z' }], station, computeSurge(station, NOW))[0].sea_level_corrected_m).toBeNull();
  });
});
