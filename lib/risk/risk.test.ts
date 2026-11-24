import { describe, expect, it } from 'vitest';
import { BREAKPOINTS, computeHazard, computeHourlyRisk, gradeOf, isStale, leanRisky, scale, sneakerRunup } from './index';
import type { HourConditions, SpotProfile, TerrainInput } from './index';

const T = '2026-11-25T15:00:00Z';

const calm: HourConditions = {
  time: T,
  waveHeightM: 0.2,
  swellHeightM: 0.2,
  swellPeriodS: 5,
  windSpeedMs: 2,
  windGustMs: 2,
  precipitationMm: 0,
  weatherCode: 0,
  seaLevelM: -1,
  riverRatio: 1,
  apparentTempC: 15,
  isDark: false,
};

const pier: SpotProfile = { type: 'pier', elevationM: 6, egressMinElevationM: 6, slopeDeg: 1 };
const jetty: SpotProfile = { type: 'jetty', elevationM: 3, egressMinElevationM: 2.5, slopeDeg: 24 };
const terrain = (score: number, confidence: TerrainInput['confidence'] = 'high'): TerrainInput => ({
  score,
  confidence,
  factors: [],
});

describe('gradeOf', () => {
  it('경계값 39/40, 69/70', () => {
    expect(gradeOf(0)).toBe('safe');
    expect(gradeOf(39)).toBe('safe');
    expect(gradeOf(40)).toBe('caution');
    expect(gradeOf(69)).toBe('caution');
    expect(gradeOf(70)).toBe('danger');
    expect(gradeOf(100)).toBe('danger');
  });
});

// 주의·위험 시작값(게이트 2에서 바뀔 수 있어 상수에서 읽는다)
const [WAVE_C, WAVE_D] = [BREAKPOINTS.wave[1][0], BREAKPOINTS.wave[2][0]];
const [SWELL_C, SWELL_D] = [BREAKPOINTS.swell[1][0], BREAKPOINTS.swell[2][0]];

describe('scale', () => {
  it('주의·위험 시작이 40·70점', () => {
    expect(scale(WAVE_C, BREAKPOINTS.wave)).toBe(40);
    expect(scale(WAVE_D, BREAKPOINTS.wave)).toBe(70);
    expect(scale(SWELL_C, BREAKPOINTS.swell)).toBe(40);
    expect(scale(SWELL_D, BREAKPOINTS.swell)).toBe(70);
    expect(scale(12, BREAKPOINTS.gust)).toBe(40);
    expect(scale(21, BREAKPOINTS.gust)).toBe(70);
    expect(scale(8, BREAKPOINTS.wind)).toBe(40);
    expect(scale(14, BREAKPOINTS.wind)).toBe(70);
    expect(scale(5, BREAKPOINTS.rain)).toBe(40);
    expect(scale(20, BREAKPOINTS.rain)).toBe(70);
    expect(scale(2, BREAKPOINTS.river)).toBe(40);
    expect(scale(4, BREAKPOINTS.river)).toBe(70);
  });

  it('작을수록 위험한 값(조석 여유, 추위)', () => {
    expect(scale(1.0, BREAKPOINTS.tide)).toBe(40);
    expect(scale(0.5, BREAKPOINTS.tide)).toBe(70);
    expect(scale(3, BREAKPOINTS.tide)).toBe(0);
    expect(scale(-1, BREAKPOINTS.tide)).toBe(100);
    expect(scale(0, BREAKPOINTS.cold)).toBe(40);
    expect(scale(-10, BREAKPOINTS.cold)).toBe(70);
  });

  it('구간 사이는 선형', () => {
    expect(scale((WAVE_C + WAVE_D) / 2, BREAKPOINTS.wave)).toBeCloseTo(55);
  });
});

describe('computeHazard', () => {
  it('잔잔하면 0', () => {
    expect(computeHazard(calm, pier).score).toBe(0);
  });

  it('H는 가장 큰 요인 점수 이상', () => {
    const h = computeHazard({ ...calm, waveHeightM: WAVE_D, windSpeedMs: 8 }, pier);
    expect(h.score).toBe(70);
    expect(h.factors[0].code).toBe('wave');
  });

  it('너울 주기는 파고 1 m 미만이면 보지 않는다', () => {
    expect(computeHazard({ ...calm, swellPeriodS: 16, swellHeightM: 0.8 }, pier).byCode.swell).toBe(0);
    expect(computeHazard({ ...calm, swellPeriodS: SWELL_D, swellHeightM: 1.2 }, pier).byCode.swell).toBe(70);
  });

  it('조석은 포인트와 퇴로 중 낮은 쪽 고도로 본다', () => {
    const h = computeHazard({ ...calm, seaLevelM: 2.0 }, jetty); // 퇴로 2.5 - 2.0 = 0.5
    expect(h.byCode.tide).toBe(70);
  });

  it('하천 유량은 하구에서만', () => {
    expect(computeHazard({ ...calm, riverRatio: 4 }, pier).byCode.river).toBe(0);
    expect(computeHazard({ ...calm, riverRatio: 4 }, { ...pier, type: 'estuary' }).byCode.river).toBe(70);
  });

  it('바람 점수는 풍속·돌풍 중 큰 쪽. 돌풍은 풍속 구간 ×1.5', () => {
    expect(computeHazard({ ...calm, windSpeedMs: 5, windGustMs: 21 }, pier).byCode.wind).toBe(70);
    expect(computeHazard({ ...calm, windSpeedMs: 14, windGustMs: 15 }, pier).byCode.wind).toBe(70);
    expect(computeHazard({ ...calm, windSpeedMs: 3, windGustMs: 12 }, pier).byCode.wind).toBe(40);
  });

  it('만 안쪽 포인트는 파랑·너울 점수를 노출 정도만큼 줄인다(하한 0.25)', () => {
    const c = { ...calm, waveHeightM: WAVE_D, swellHeightM: 2.0, swellPeriodS: SWELL_D };
    expect(computeHazard(c, { ...pier, waveExposure: 0.5 }).byCode.wave).toBe(35);
    expect(computeHazard(c, { ...pier, waveExposure: 0.5 }).byCode.swell).toBe(35);
    expect(computeHazard(c, { ...pier, waveExposure: 0 }).byCode.wave).toBeCloseTo(17.5);
    expect(computeHazard(c, pier).byCode.wave).toBe(70);
    expect(computeHazard(c, { ...pier, waveExposure: 0.5 }).factors[0].label).toContain('이곳은 파랑이 줄어듦');
  });

  it('스니커 웨이브: Stockdon 처오름, 긴 주기일수록 크고 해변·갯바위·방파제에만', () => {
    const beach: SpotProfile = { type: 'beach', elevationM: 2, egressMinElevationM: null, slopeDeg: 2 };
    // H0 2 m, T 12 s → L0 = 9.81·144/2π ≈ 224.8 m → R2 = 0.043·√449.6 ≈ 0.912 m
    expect(sneakerRunup({ ...calm, swellHeightM: 2, swellPeriodS: 12 }, beach, 1)).toBeCloseTo(0.912, 2);
    const short = sneakerRunup({ ...calm, swellHeightM: 2, swellPeriodS: 8 }, beach, 1)!;
    const long = sneakerRunup({ ...calm, swellHeightM: 2, swellPeriodS: 18 }, beach, 1)!;
    expect(long / short).toBeCloseTo(18 / 8); // 처오름은 주기에 비례
    expect(sneakerRunup({ ...calm, swellHeightM: 2, swellPeriodS: 12 }, beach, 0.25)).toBeCloseTo(0.456, 2); // 노출 1/4 → √
    expect(sneakerRunup({ ...calm, swellHeightM: 2, swellPeriodS: 12 }, pier, 1)).toBeNull();
    expect(sneakerRunup({ ...calm, swellHeightM: null, waveHeightM: null, swellPeriodS: 12 }, beach, 1)).toBeNull();
  });

  it('스니커 요인 = 해수면 + 처오름과 발밑 고도의 여유', () => {
    const beach: SpotProfile = { type: 'beach', elevationM: 2, egressMinElevationM: null, slopeDeg: 2 };
    // 해수면 1.0 + 처오름 0.912 → 여유 0.088 m → 0.5~0 m 구간: 70 + (0.5-0.088)/0.5·30 ≈ 94.7
    const h = computeHazard({ ...calm, seaLevelM: 1.0, swellHeightM: 2, swellPeriodS: 12 }, beach);
    expect(h.byCode.sneaker).toBeCloseTo(94.7, 0);
    expect(h.factors.find((f) => f.code === 'sneaker')!.label).toContain('너울 처오름 약 0.9 m(주기 12초)');
    // 간조(-1.0 m)면 여유 2.09 m → 0점
    expect(computeHazard({ ...calm, seaLevelM: -1.0, swellHeightM: 2, swellPeriodS: 12 }, beach).byCode.sneaker).toBe(0);
    // 해수면을 모르면 계산하지 않는다
    expect(computeHazard({ ...calm, seaLevelM: null, swellHeightM: 2, swellPeriodS: 12 }, beach).byCode.sneaker).toBe(0);
  });

  it('빠진 핵심 예보를 기록한다', () => {
    const h = computeHazard({ ...calm, waveHeightM: null, seaLevelM: null }, pier);
    expect(h.missing).toEqual(['wave', 'seaLevel']);
  });
});

describe('computeHourlyRisk', () => {
  it('R = 0.4V + 0.6H + B', () => {
    const r = computeHourlyRisk({ ...calm, waveHeightM: WAVE_D }, pier, terrain(20));
    expect(r.hazard).toBe(70);
    expect(r.bonus).toBe(0);
    expect(r.score).toBe(Math.round(0.4 * 20 + 0.6 * 70));
    expect(r.grade).toBe('caution');
  });

  it('급경사 방파제 + 긴 주기 너울이면 가산', () => {
    const c = { ...calm, swellHeightM: 1.5, swellPeriodS: 12 };
    const withBonus = computeHourlyRisk(c, jetty, terrain(60));
    const noBonus = computeHourlyRisk(c, { ...jetty, slopeDeg: 5 }, terrain(60));
    expect(withBonus.score - noBonus.score).toBe(10);
  });

  it('가산점은 20점을 넘지 않는다', () => {
    const c = { ...calm, swellHeightM: 1.5, swellPeriodS: 12, seaLevelM: 2.3, isDark: true };
    expect(computeHourlyRisk(c, jetty, terrain(60)).bonus).toBe(20);
  });

  it('점수는 100을 넘지 않는다', () => {
    const c = { ...calm, waveHeightM: 5, swellHeightM: 5, swellPeriodS: 20, seaLevelM: 3 };
    expect(computeHourlyRisk(c, jetty, terrain(100)).score).toBe(100);
  });

  it('발효 중인 경보가 있으면 점수와 무관하게 danger', () => {
    const alerts = [{ source: 'NWS', event: 'High Surf Advisory', headline: '높은 파도 주의보 발효 중', expires: '2026-11-26T06:00:00Z' }];
    const r = computeHourlyRisk(calm, pier, terrain(10), alerts);
    expect(r.score).toBeLessThan(40);
    expect(r.grade).toBe('danger');
    expect(r.forced).toBe('alert');
    expect(r.causes[0]).toEqual({ code: 'alert', label: '높은 파도 주의보 발효 중' });
  });

  it('만료된 경보는 무시', () => {
    const alerts = [{ source: 'NWS', event: 'X', headline: 'x', expires: '2026-11-25T14:00:00Z' }];
    expect(computeHourlyRisk(calm, pier, terrain(10), alerts).grade).toBe('safe');
  });

  it('뇌우 예보면 danger', () => {
    const r = computeHourlyRisk({ ...calm, weatherCode: 95 }, pier, terrain(10));
    expect(r.grade).toBe('danger');
    expect(r.causes[0].code).toBe('thunder');
  });

  it('원인은 영향 순서로 최대 3개, 지형 요인 포함', () => {
    const t: TerrainInput = {
      score: 64,
      confidence: 'medium',
      factors: [
        { code: 'slope', label: '급경사 암반', score: 80 },
        { code: 'low_elevation', label: '저지대', score: 10 },
      ],
    };
    const c = { ...calm, waveHeightM: (WAVE_C + WAVE_D) / 2, windSpeedMs: 8, precipitationMm: 6 };
    const r = computeHourlyRisk(c, { ...jetty, slopeDeg: 5 }, t);
    // 파랑 0.6·55=33, 경사 0.4·80=32, 강수 0.6·42=25, 바람 0.6·40=24
    expect(r.causes.map((x) => x.code)).toEqual(['wave', 'slope', 'rain']);
  });

  it('요인이 없으면 안내 문장 하나', () => {
    expect(computeHourlyRisk(calm, pier, terrain(5)).causes).toEqual([{ code: 'calm', label: '뚜렷한 위험 요인 없음' }]);
  });

  it('조석 위험이 들어가면 신뢰도 낮음, 경계 바로 아래 점수는 경계로', () => {
    const r = computeHourlyRisk({ ...calm, seaLevelM: 5.2 }, pier, terrain(5)); // 여유 0.8 m → 52점
    expect(r.confidence).toBe('low');
    expect(r.hazard).toBe(52);
    // 0.4·5 + 0.6·52 = 33.2 → 33, 경계 40에서 5점 밖이므로 그대로
    expect(r.score).toBe(33);
    expect(leanRisky(36, 'low')).toBe(40);
    expect(leanRisky(66, 'low')).toBe(70);
    expect(leanRisky(64, 'low')).toBe(64);
    expect(leanRisky(36, 'medium')).toBe(36);
  });
});

describe('예보 없음', () => {
  it('핵심 예보가 모두 없으면 최소 caution, 원인 맨 앞에 안내', () => {
    const none: HourConditions = {
      ...calm,
      waveHeightM: null,
      swellHeightM: null,
      swellPeriodS: null,
      windSpeedMs: null,
      windGustMs: null,
      seaLevelM: null,
    };
    const r = computeHourlyRisk(none, pier, terrain(5));
    expect(r.noForecast).toBe(true);
    expect(r.score).toBe(40);
    expect(r.grade).toBe('caution');
    expect(r.confidence).toBe('low');
    expect(r.causes).toEqual([{ code: 'no_forecast', label: '이 시간대 예보가 아직 없음' }]);
  });

  it('일부만 없으면 noForecast가 아니다', () => {
    expect(computeHourlyRisk({ ...calm, seaLevelM: null }, pier, terrain(5)).noForecast).toBe(false);
  });
});

describe('isStale', () => {
  it('6시간 초과면 true', () => {
    expect(isStale('2026-11-25T09:00:00Z', T)).toBe(false);
    expect(isStale('2026-11-25T08:59:00Z', T)).toBe(true);
  });
});
