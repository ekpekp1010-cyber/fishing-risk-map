import { describe, expect, it } from 'vitest';
import { HORIZON, isNight, nightSpans, skyLook, sunEvents, sunPosition } from './sun';

// 시범 지역(오리건주 뉴포트)
const LNG = -124.062;
const LAT = 44.632;
const HOUR = 3_600_000;

/** 하루 동안 태양이 가장 높이 올랐을 때 */
function highest(dayStartUtc: string) {
  const start = Date.parse(dayStartUtc);
  let best = { at: start, ...sunPosition(start, LNG, LAT) };
  for (let t = start; t < start + 24 * HOUR; t += 60_000) {
    const p = sunPosition(t, LNG, LAT);
    if (p.altitude > best.altitude) best = { at: t, ...p };
  }
  return best;
}

describe('sunPosition', () => {
  it('한낮 높이가 위도와 계절에 맞다(하지 90 - 위도 + 23.44, 동지 90 - 위도 - 23.44)', () => {
    expect(highest('2026-06-21T08:00:00Z').altitude).toBeCloseTo(90 - LAT + 23.44, 0);
    expect(highest('2026-12-21T08:00:00Z').altitude).toBeCloseTo(90 - LAT - 23.44, 0);
  });

  it('가장 높이 뜬 때 정남에 있고, 그 시각은 경도로 정해지는 태양시 정오다', () => {
    const noon = highest('2026-06-21T08:00:00Z');
    expect(noon.azimuth).toBeGreaterThan(178);
    expect(noon.azimuth).toBeLessThan(182);
    // 경도 -124.062도 → 12시 + 8시간 16분(UTC). 균시차 때문에 몇 분 어긋난다.
    const expected = Date.parse('2026-06-21T20:16:00Z');
    expect(Math.abs(noon.at - expected)).toBeLessThan(10 * 60_000);
  });

  it('오전에는 동쪽, 오후에는 서쪽에 있다', () => {
    expect(sunPosition(Date.parse('2026-06-21T16:00:00Z'), LNG, LAT).azimuth).toBeLessThan(180);
    expect(sunPosition(Date.parse('2026-06-22T00:00:00Z'), LNG, LAT).azimuth).toBeGreaterThan(180);
  });

  it('춘분 정오의 적도에서는 머리 위에 있다', () => {
    expect(sunPosition(Date.parse('2026-03-20T12:00:00Z'), 0, 0).altitude).toBeGreaterThan(87);
  });
});

describe('sunEvents', () => {
  // 현지 2026-11-25 00:00 ~ 11-26 00:00 (PST = UTC-8)
  const from = Date.parse('2026-11-25T08:00:00Z');
  const events = sunEvents(from, from + 24 * HOUR, LNG, LAT);

  it('하루에 해가 한 번 뜨고 한 번 진다', () => {
    expect(events.map((e) => e.kind)).toEqual(['rise', 'set']);
  });

  it('11월 말 뉴포트의 해 뜨는 시각은 07:25쯤, 지는 시각은 16:40쯤이다', () => {
    const [rise, set] = events;
    expect(Math.abs(rise.at - Date.parse('2026-11-25T15:25:00Z'))).toBeLessThan(8 * 60_000);
    expect(Math.abs(set.at - Date.parse('2026-11-26T00:40:00Z'))).toBeLessThan(8 * 60_000);
  });

  it('찾은 시각에 태양이 지평선에 걸려 있다', () => {
    for (const e of events) expect(sunPosition(e.at, LNG, LAT).altitude).toBeCloseTo(HORIZON, 1);
  });
});

describe('nightSpans', () => {
  it('밤에 시작해 밤에 끝나는 72시간은 밤이 네 번이다', () => {
    const from = Date.parse('2026-11-25T08:00:00Z');
    const spans = nightSpans(from, from + 71 * HOUR, LNG, LAT);
    expect(spans).toHaveLength(4);
    expect(spans[0][0]).toBe(0);
    expect(spans[3][1]).toBe(1);
    for (const [a, b] of spans) expect(b).toBeGreaterThan(a);
  });

  it('낮에 시작하면 첫 구간은 해가 진 뒤부터다', () => {
    const from = Date.parse('2026-11-25T20:00:00Z');
    const [first] = nightSpans(from, from + 24 * HOUR, LNG, LAT);
    expect(first[0]).toBeGreaterThan(0);
    expect(isNight(sunPosition(from, LNG, LAT).altitude)).toBe(false);
  });
});

describe('skyLook', () => {
  it('한낮은 어둠이 없고 한밤은 완전히 어둡다', () => {
    expect(skyLook(40).darkness).toBe(0);
    expect(skyLook(null).darkness).toBe(0);
    expect(skyLook(-30).darkness).toBe(1);
  });

  it('해가 낮아질수록 어두워진다', () => {
    const steps = [10, 3, 0, -3, -6, -9].map((alt) => skyLook(alt).darkness);
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThanOrEqual(steps[i - 1]);
    expect(skyLook(0).darkness).toBeGreaterThan(0);
    expect(skyLook(0).darkness).toBeLessThan(0.5);
  });

  it('한낮의 하늘색은 지도의 기본 하늘색과 같다', () => {
    expect(skyLook(null)).toMatchObject({ skyColor: 'rgb(127, 178, 229)', horizonColor: 'rgb(220, 233, 245)' });
  });
});
