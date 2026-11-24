// 시각은 API와 같이 ISO 8601 UTC 정시 단위로 다루고, 화면에는 시범 지역(오리건)의 현지 시각으로 보여 준다.

export const PLACE_TZ = 'America/Los_Angeles';
export const HOURS_AHEAD = 72;
const HOUR_MS = 3_600_000;

const toIso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');

export function floorToHourIso(d: Date): string {
  return toIso(Math.floor(d.getTime() / HOUR_MS) * HOUR_MS);
}

export function addHoursIso(iso: string, hours: number): string {
  return toIso(Date.parse(iso) + hours * HOUR_MS);
}

const dayKeyFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: PLACE_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const clockFmt = new Intl.DateTimeFormat('ko-KR', {
  timeZone: PLACE_TZ,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const monthDayFmt = new Intl.DateTimeFormat('ko-KR', {
  timeZone: PLACE_TZ,
  month: 'long',
  day: 'numeric',
});
const hourFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: PLACE_TZ,
  hour: 'numeric',
  hourCycle: 'h23',
});

export function formatClock(iso: string): string {
  return clockFmt.format(new Date(iso));
}

/** 현지 기준 0~23시. */
export function placeHour(iso: string): number {
  return Number(hourFmt.format(new Date(iso))) % 24;
}

/** "오늘 15:00", "내일 03:00", "11월 27일 09:00" */
export function formatPlaceTime(iso: string, nowIso: string): string {
  const dayDiff = Math.round(
    (Date.parse(dayKeyFmt.format(new Date(iso))) - Date.parse(dayKeyFmt.format(new Date(nowIso)))) /
      (24 * HOUR_MS),
  );
  const day =
    dayDiff === 0 ? '오늘' : dayDiff === 1 ? '내일' : dayDiff === 2 ? '모레' : monthDayFmt.format(new Date(iso));
  return `${day} ${formatClock(iso)}`;
}
