// 시간 막대에 맞춰 보여 주는 기온 예보. 실시간 격자(live.ts)와 같은 지점들의 시간별 값을 한 번에 받는다.
// 출처는 Open-Meteo(키 불필요, 무료 사용은 비상업 용도). 브라우저에서 직접 부른다.

import { addHoursIso, HOURS_AHEAD } from '../ui/time';
import { liveAxes, type TempField } from './live';

interface ForecastCell {
  hourly_units?: { temperature_2m?: string; apparent_temperature?: string };
  hourly?: {
    time: number[];
    temperature_2m: (number | null)[];
    apparent_temperature: (number | null)[];
  };
}

/** 한 시각의 기온과 체감 온도 격자 */
export interface TempHour extends TempField {
  feels: number[][];
}

/** 시각(UTC 초) → 그 시각의 격자 */
export type TempForecast = Map<number, TempHour>;

/**
 * 지점별 응답을 시각별 격자로 바꾼다. 응답 순서는 요청한 지점 순서(남쪽 줄부터, 줄 안에서는 서쪽부터)와 같다.
 * 한 지점이라도 값이 빠진 시각은 버린다. 격자에 구멍이 있으면 색을 이어 붙일 수 없다.
 */
export function readTempForecast(cells: ForecastCell[], lngs: number[], lats: number[]): TempForecast {
  const hours: TempForecast = new Map();
  if (!Array.isArray(cells) || cells.length !== lngs.length * lats.length) return hours;
  const first = cells[0]?.hourly;
  if (!first) return hours;
  const usable = cells.every(
    (c) =>
      c.hourly_units?.temperature_2m === '°C' &&
      c.hourly_units.apparent_temperature === '°C' &&
      c.hourly?.time.length === first.time.length,
  );
  if (!usable) return hours;

  first.time.forEach((time, i) => {
    if (!Number.isFinite(time)) return;
    const grid = (pick: (cell: ForecastCell) => number | null | undefined) =>
      lats.map((_, r) => lngs.map((_, c) => pick(cells[r * lngs.length + c])));
    const temp = grid((cell) => (cell.hourly?.time[i] === time ? cell.hourly.temperature_2m[i] : null));
    const feels = grid((cell) => cell.hourly?.apparent_temperature[i]);
    const complete = (g: (number | null | undefined)[][]): g is number[][] =>
      g.every((row) => row.every((v) => typeof v === 'number' && Number.isFinite(v)));
    if (complete(temp) && complete(feels)) hours.set(time, { lngs, lats, temp, feels });
  });
  return hours;
}

export async function loadTempForecast(baseTime: string, signal: AbortSignal): Promise<TempForecast> {
  const { lngs, lats } = liveAxes();
  const points = lats.flatMap((lat) => lngs.map((lng) => ({ lat, lng })));
  const params = new URLSearchParams({
    latitude: points.map((p) => p.lat).join(','),
    longitude: points.map((p) => p.lng).join(','),
    hourly: 'temperature_2m,apparent_temperature',
    timeformat: 'unixtime',
    timezone: 'GMT',
    start_hour: baseTime.slice(0, 16),
    end_hour: addHoursIso(baseTime, HOURS_AHEAD - 1).slice(0, 16),
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
  });
  if (!response.ok) throw new Error(`Forecast API HTTP ${response.status}`);
  return readTempForecast(await response.json(), lngs, lats);
}
