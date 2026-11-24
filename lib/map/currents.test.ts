import { describe, expect, it } from 'vitest';
import { readCurrentForecast } from './currents';
import { createCurrentField } from './current-flow';

const cell = {
  latitude: 44.625,
  longitude: -124.20833,
  hourly_units: { ocean_current_velocity: 'km/h', ocean_current_direction: '°' },
  hourly: {
    time: [3600, 7200, 10800, 14400],
    ocean_current_velocity: [3.6, 0, null, 1.8],
    ocean_current_direction: [90, null, 180, null],
  },
};

describe('hourly ocean currents', () => {
  it('preserves the flow bearing and converts km/h to m/s at the matching UTC hour', () => {
    const hours = readCurrentForecast([cell, { ...cell, latitude: 44.8 }]);
    expect(hours.get(3600)).toEqual([
      { lat: 44.625, lng: -124.20833, speed: 1, direction: 90 },
      { lat: 44.8, lng: -124.20833, speed: 1, direction: 90 },
    ]);
  });

  it('distinguishes still water from missing speed or bearing', () => {
    const hours = readCurrentForecast([cell]);
    expect(hours.get(7200)?.[0]).toMatchObject({ speed: 0, direction: null });
    expect(hours.has(10800)).toBe(false);
    expect(hours.has(14400)).toBe(false);
  });

  it('omits samples with unknown units', () => {
    expect(readCurrentForecast([{ ...cell, hourly_units: {} }]).size).toBe(0);
  });
});

describe('current particle field', () => {
  const grid = [44, 45].flatMap(lat => [
    { lat, lng: -125, speed: 1, direction: 350 },
    { lat, lng: -124, speed: 1, direction: 10 },
  ]);
  it('interpolates through north across the compass boundary', () => {
    const flow = createCurrentField(grid)?.velocity(-124.5, 44.5);
    expect(flow?.east).toBeCloseTo(0);
    expect(flow?.north).toBeCloseTo(Math.cos(Math.PI / 18));
  });
  it('leaves incomplete cells and points outside the forecast empty', () => {
    expect(createCurrentField(grid.slice(1))?.velocity(-124.5, 44.5)).toBeNull();
    expect(createCurrentField(grid)?.velocity(-123.9, 44.5)).toBeNull();
  });
});
