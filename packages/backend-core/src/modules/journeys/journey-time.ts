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
