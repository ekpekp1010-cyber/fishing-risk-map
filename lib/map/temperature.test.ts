import { describe, expect, it } from 'vitest';
import { readTempForecast } from './temperature';

const lngs = [-125, -124];
const lats = [44, 45];
const units = { temperature_2m: '°C', apparent_temperature: '°C' };
/** 지점 순서: 남쪽 줄부터, 줄 안에서는 서쪽부터 */
const cellAt = (base: number) => ({
  hourly_units: units,
  hourly: {
    time: [3600, 7200],
    temperature_2m: [base, base + 1] as (number | null)[],
    apparent_temperature: [base - 2, base - 1] as (number | null)[],
  },
});
const cells = [10, 11, 12, 13].map(cellAt);

describe('hourly temperature grid', () => {
  it('places each point at its row and column for the matching UTC hour', () => {
    const hours = readTempForecast(cells, lngs, lats);
    expect(hours.get(3600)).toEqual({ lngs, lats, temp: [[10, 11], [12, 13]], feels: [[8, 9], [10, 11]] });
    expect(hours.get(7200)?.temp).toEqual([[11, 12], [13, 14]]);
  });

  it('drops an hour when any point is missing, and keeps the others', () => {
    const holed = cells.map((c, i) =>
      i === 2 ? { ...c, hourly: { ...c.hourly, temperature_2m: [null, 13] } } : c,
    );
    const hours = readTempForecast(holed, lngs, lats);
    expect(hours.has(3600)).toBe(false);
    expect(hours.has(7200)).toBe(true);
  });

  it('returns nothing when the points do not fill the grid or the unit is unknown', () => {
    expect(readTempForecast(cells.slice(1), lngs, lats).size).toBe(0);
    expect(readTempForecast([{ ...cells[0], hourly_units: {} }, ...cells.slice(1)], lngs, lats).size).toBe(0);
  });
});
