import { addHoursIso, HOURS_AHEAD } from '../ui/time';

// 뉴포트 앞바다의 해상 지점만 요청한다. 표시 위치는 API가 반환한 모델 격자 중심이다.
const latitudes = [44.44, 44.64, 44.84];
const longitudes = [-124.65, -124.42, -124.18];

interface MarineCell {
  latitude: number;
  longitude: number;
  hourly_units?: { ocean_current_velocity?: string; ocean_current_direction?: string };
  hourly?: {
    time: number[];
    ocean_current_velocity: (number | null)[];
    ocean_current_direction: (number | null)[];
  };
}

export interface OceanCurrent {
  lat: number;
  lng: number;
  speed: number;
  direction: number | null;
}

export type CurrentForecast = Map<number, OceanCurrent[]>;

export function readCurrentForecast(cells: MarineCell[]): CurrentForecast {
  const hours: CurrentForecast = new Map();
  for (const { latitude: lat, longitude: lng, hourly, hourly_units: units } of cells) {
    if (!hourly || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (units?.ocean_current_velocity !== 'km/h' || units.ocean_current_direction !== '°') continue;
    hourly.time.forEach((time, i) => {
      const speed = hourly.ocean_current_velocity[i];
      const direction = hourly.ocean_current_direction[i];
      if (!Number.isFinite(time) || typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0) return;
      if (speed > 0 && (typeof direction !== 'number' || !Number.isFinite(direction) || direction < 0 || direction > 360)) return;
      const hour = hours.get(time);
      const sample = { lat, lng, speed: speed / 3.6, direction: speed === 0 ? null : direction };
      if (hour) hour.push(sample);
      else hours.set(time, [sample]);
    });
  }
  return hours;
}

export async function loadCurrentForecast(baseTime: string, signal: AbortSignal): Promise<CurrentForecast> {
  const points = latitudes.flatMap(lat => longitudes.map(lng => ({ lat, lng })));
  const params = new URLSearchParams({
    latitude: points.map(p => p.lat).join(','),
    longitude: points.map(p => p.lng).join(','),
    hourly: 'ocean_current_velocity,ocean_current_direction',
    timeformat: 'unixtime',
    timezone: 'GMT',
    cell_selection: 'sea',
    start_hour: baseTime.slice(0, 16),
    end_hour: addHoursIso(baseTime, HOURS_AHEAD - 1).slice(0, 16),
  });
  const response = await fetch(`https://marine-api.open-meteo.com/v1/marine?${params}`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
  });
  if (!response.ok) throw new Error(`Marine API HTTP ${response.status}`);
  return readCurrentForecast(await response.json());
}
