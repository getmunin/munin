import type { Weekday } from '@getmunin/types';
import { inTimeWindow, localClock } from './journey-conditions.ts';

const STEP_MS = 15 * 60_000;
const SEARCH_LIMIT_MS = 8 * 86_400_000;

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

export function stableBucket(...parts: string[]): number {
  let hash = 2166136261;
  for (const ch of parts.join('|')) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100;
}

const RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
  3 * 60 * 60_000,
  6 * 60 * 60_000,
  12 * 60 * 60_000,
  ...Array.from({ length: 5 }, () => 24 * 60 * 60_000),
];
export const MAX_ACTION_ATTEMPTS = RETRY_DELAYS_MS.length;

export function retryDelayMs(attempt: number): number | null {
  return RETRY_DELAYS_MS[attempt - 1] ?? null;
}

export function nextLocalOccurrence(now: Date, at: string, timezone: string, weekday: Weekday | null): Date {
  const [h, m] = at.split(':').map(Number);
  const target = h! * 60 + m!;
  const base = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const local = localClock(base, timezone).minutes;
  let delta = (target - local + 1440) % 1440;
  if (delta === 0) delta = 1440;
  let candidate = new Date(base.getTime() + delta * 60_000);
  for (let day = 0; day < 8; day++) {
    const clock = localClock(candidate, timezone);
    if (clock.minutes !== target) {
      candidate = new Date(candidate.getTime() + (target - clock.minutes) * 60_000);
    }
    if (candidate.getTime() > now.getTime() && (!weekday || localClock(candidate, timezone).weekday === weekday)) {
      return candidate;
    }
    candidate = new Date(candidate.getTime() + 86_400_000);
  }
  return candidate;
}
