import { describe, expect, it } from 'vitest';
import spotRiskFixture from '../contract/fixtures/spot-risk.json';
import { addHours, buildSpotRisk, buildSpots, floorHour, localClock, nextHighTide } from './assemble';
import type { AlertRow, ForecastHourlyRow, SpotRow, TerrainScoreRow } from './db-types';
import { ApiError, parseBbox, parseIntIn, parseTime } from './http';
import { headlineKo, parseAlerts } from './nws';
import { fetchForecastRows, mergeCell, riverByDay, toIsoUtc } from './open-meteo';

const T = '2026-11-25T15:00:00Z';
const NOW = new Date('2026-11-25T15:20:00Z');

function fRow(time: string, over: Partial<ForecastHourlyRow> = {}): ForecastHourlyRow {
  return {
    cell_id: '44.60_-124.05',
    time,
    wave_height_m: 0.5,
    wave_period_s: 8,
    wave_direction_deg: 270,
    swell_height_m: 0.5,
    swell_period_s: 8,
    swell_direction_deg: 270,
    wind_speed_ms: 3,
    wind_gust_ms: 4,
    wind_direction_deg: 0,
    precipitation_mm: 0,
    weather_code: 1,
    sea_level_m: 0,
    sea_level_corrected_m: null,
    river_discharge_m3s: null,
    river_ratio: null,
    apparent_temp_c: 12,
    is_dark: false,
    raw: null,
    fetched_at: '2026-11-25T14:10:00Z',
    ...over,
  };
}

const spot: SpotRow = {
  id: 'south-jetty-mid',
  name: '사우스 제티 중간',
  type: 'jetty',
  lat: 44.6131,
  lng: -124.0712,
  access_walk_minutes: 12,
  access_from: '사우스 제티 주차장',
  forecast_cell_id: '44.60_-124.05',
  active: true,
};
const terrain: TerrainScoreRow = {
  spot_id: spot.id,
  score: 64,
  slope_deg: 24,
  elevation_m: 3,
  cover: '암반',
  flood_frequency: 'high',
  egress_min_elevation_m: 2.5,
  factors: [{ code: 'slope', label: '급경사 암반', score: 80, weight: 20, contribution: 16 }],
  confidence: 'medium',
};

describe('open-meteo', () => {
  it('시각에 Z를 붙인다', () => {
    expect(toIsoUtc('2026-11-24T00:00')).toBe('2026-11-24T00:00:00Z');
  });

  it('하천 유량 비는 과거 30일 중앙값 기준', () => {
    const m = riverByDay({ time: ['2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25'], river_discharge: [10, 20, 30, 60] }, '2026-11-24');
    expect(m.get('2026-11-25')).toEqual({ discharge: 60, ratio: 4 });
  });

  it('세 응답을 시간별 행으로 합친다', () => {
    const rows = mergeCell(
      'c1',
      { hourly: { time: ['2026-11-25T00:00', '2026-11-25T01:00'], wave_height: [2.1, 2.2], sea_level_height_msl: [1.0, 1.1] } },
      { hourly: { time: ['2026-11-25T00:00'], wind_speed_10m: [9], is_day: [0], weather_code: [95] } },
      { daily: { time: ['2026-11-24', '2026-11-25'], river_discharge: [10, 20] } },
      '2026-11-25T00:10:00.000Z',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ time: '2026-11-25T00:00:00Z', wave_height_m: 2.1, wind_speed_ms: 9, is_dark: true, weather_code: 95, river_ratio: 2 });
    expect(rows[1].wind_speed_ms).toBeNull();
  });

  it('여러 셀을 한 번에 요청하고 한 API가 실패해도 행을 만든다', async () => {
    const urls: string[] = [];
    const fake = (async (u: string) => {
      urls.push(u);
      if (u.includes('flood')) return new Response('down', { status: 502 });
      const body = [0, 1].map(() => ({ hourly: { time: ['2026-11-25T15:00'], wave_height: [1], wind_speed_10m: [5] } }));
      return Response.json(body);
    }) as typeof fetch;
    const cells = [
      { id: 'a', lat: 44.6, lng: -124.1 },
      { id: 'b', lat: 44.65, lng: -124.05 },
    ];
    const { rows, errors } = await fetchForecastRows(cells, NOW, fake);
    expect(urls).toHaveLength(3);
    expect(urls[0]).toContain('latitude=44.60%2C44.65');
    expect(rows.map((r) => r.cell_id)).toEqual(['a', 'b']);
    expect(errors).toHaveLength(1);
  });
});

describe('nws', () => {
  it('테스트·취소를 빼고 한국어 문장을 붙인다', () => {
    const rows = parseAlerts(
      {
        features: [
          { properties: { id: 'a', event: 'High Surf Advisory', expires: '2026-11-26T00:00:00Z', ends: '2026-11-26T06:00:00Z' } },
          { properties: { id: 'b', event: 'High Surf Advisory', status: 'Test' } },
          { properties: { id: 'c', event: 'Gale Warning', messageType: 'Cancel' } },
        ],
      },
      T,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'a', headline: '높은 파도 주의보 발효 중', expires: '2026-11-26T06:00:00Z' });
    expect(headlineKo('Unknown Event')).toBe('Unknown Event 발효 중');
  });
});

describe('http', () => {
  it('쿼리 검사', () => {
    expect(parseTime(null, NOW)).toBe('2026-11-25T15:00:00Z');
    expect(parseTime('2026-11-25T15:40:00Z')).toBe(T);
    expect(() => parseTime('abc')).toThrow(ApiError);
    expect(parseIntIn(null, 'hours', 1, 72, 72)).toBe(72);
    expect(() => parseIntIn('73', 'hours', 1, 72, 72)).toThrow(ApiError);
    expect(parseBbox('-124.1,44.59,-124.02,44.69')).toEqual({ west: -124.1, south: 44.59, east: -124.02, north: 44.69 });
    expect(() => parseBbox('1,2,3')).toThrow(ApiError);
  });
});

describe('assemble', () => {
  it('시각 도우미', () => {
    expect(floorHour(NOW)).toBe(T);
    expect(addHours(T, 2)).toBe('2026-11-25T17:00:00Z');
    expect(localClock('2026-11-26T00:40:00Z')).toBe('16:40'); // 태평양 표준시
  });

  it('다음 만조', () => {
    const levels = [0.1, 0.5, 0.9, 1.2, 1.0, 0.6];
    const series = levels.map((v, i) => fRow(addHours(T, i), { sea_level_m: v }));
    expect(nextHighTide(series, T)).toBe(addHours(T, 3));
  });

  it('지형 분석이 없는 포인트는 목록에서 뺀다', () => {
    const other: SpotRow = { ...spot, id: 'x' };
    const res = buildSpots(T, [spot, other], [terrain], [fRow(T)], []);
    expect(res.spots.map((s) => s.id)).toEqual([spot.id]);
  });

  it('상세 응답은 계약 fixture와 같은 키를 갖는다', () => {
    const series = Array.from({ length: 20 }, (_, i) => fRow(addHours(T, i)));
    const alerts: AlertRow[] = [
      { id: 'a', source: 'NWS', event: 'High Surf Advisory', headline: '높은 파도 주의보 발효 중', severity: null, onset: T, expires: addHours(T, 2), fetched_at: T },
    ];
    const res = buildSpotRisk(spot, terrain, series, alerts, T, 3, NOW)!;
    const keys = (o: object) => Object.keys(o).sort();
    expect(keys(res)).toEqual(keys(spotRiskFixture));
    expect(keys(res.spot)).toEqual(keys(spotRiskFixture.spot));
    expect(keys(res.terrain)).toEqual(keys(spotRiskFixture.terrain));
    expect(keys(res.hourly[0])).toEqual(keys(spotRiskFixture.hourly[0]));
    expect(res.terrain.factors[0]).toEqual({ code: 'slope', label: '급경사 암반', score: 80 });
    expect(res.hourly.map((h) => h.grade)).toEqual(['danger', 'danger', res.hourly[2].grade]);
    expect(res.hourly[2].causes[0].code).not.toBe('alert');
    expect(res.stale).toBe(false);
    expect(res.alerts).toHaveLength(1);
  });

  it('예보가 6시간 넘게 지나면 stale', () => {
    const series = [fRow(T, { fetched_at: '2026-11-25T09:00:00Z' })];
    expect(buildSpotRisk(spot, terrain, series, [], T, 1, NOW)!.stale).toBe(true);
  });

  it('예보가 없으면 null', () => {
    expect(buildSpotRisk(spot, terrain, [], [], T, 1, NOW)).toBeNull();
  });
});
