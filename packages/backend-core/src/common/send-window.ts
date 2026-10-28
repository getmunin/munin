import type { Weekday } from '@getmunin/types';

const STEP_MS = 15 * 60_000;
const SEARCH_LIMIT_MS = 8 * 86_400_000;

const WEEKDAY_BY_SHORT: Record<string, Weekday> = {
  Mon: 'mon',
  Tue: 'tue',
  Wed: 'wed',
  Thu: 'thu',
  Fri: 'fri',
  Sat: 'sat',
  Sun: 'sun',
};

export function localClock(now: Date, timezone: string): { weekday: Weekday; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    weekday: WEEKDAY_BY_SHORT[get('weekday')] ?? 'mon',
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

export function inTimeWindow(minutes: number, window: string): boolean {
  const [from, to] = window.split('-').map((hm) => {
    const [h, m] = hm.split(':').map(Number);
    return h! * 60 + m!;
  });
  return from! <= to! ? minutes >= from! && minutes < to! : minutes >= from! || minutes < to!;
}

export function nextValidTime(
  from: Date,
  timezone: string,
  validDays?: readonly Weekday[],
  validHours?: string,
): Date {
  if (!validDays && !validHours) return from;
  const fits = (at: Date) => {
    const clock = localClock(at, timezone);
    if (validDays && !validDays.includes(clock.weekday)) return false;
    if (validHours && !inTimeWindow(clock.minutes, validHours)) return false;
    return true;
  };
  if (fits(from)) return from;
  const start = Math.ceil(from.getTime() / STEP_MS) * STEP_MS;
  for (let t = start; t - from.getTime() <= SEARCH_LIMIT_MS; t += STEP_MS) {
    const at = new Date(t);
    if (fits(at)) return at;
  }
  return from;
}

export function nextSendableTime(
  from: Date,
  timezone: string,
  rules: { validDays?: readonly Weekday[] | null; quietWindows: readonly string[] },
): Date | null {
  const fits = (at: Date) => {
    const clock = localClock(at, timezone);
    if (rules.validDays && !rules.validDays.includes(clock.weekday)) return false;
    return !rules.quietWindows.some((window) => inTimeWindow(clock.minutes, window));
  };
  if (fits(from)) return from;
  const start = Math.ceil(from.getTime() / STEP_MS) * STEP_MS;
  for (let t = start; t - from.getTime() <= SEARCH_LIMIT_MS; t += STEP_MS) {
    const at = new Date(t);
    if (fits(at)) return at;
  }
  return null;
}
