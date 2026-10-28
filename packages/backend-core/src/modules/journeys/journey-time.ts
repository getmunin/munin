import type { Weekday } from '@getmunin/types';
import { localClock, nextValidTime } from '../../common/send-window.ts';

export { nextValidTime };

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

const NAIVE_LOCAL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

export function parseZonedDate(value: unknown, timezone: string): Date | null {
  if (value instanceof Date) return value;
  if (typeof value !== 'string') return null;
  if (!NAIVE_LOCAL_TIME.test(value)) {
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : new Date(t);
  }
  const asUtc = Date.parse(`${value}Z`);
  if (Number.isNaN(asUtc)) return null;
  const first = asUtc - zoneOffsetMs(asUtc, timezone);
  return new Date(asUtc - zoneOffsetMs(first, timezone));
}

function zoneOffsetMs(at: number, timezone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(at))
      .map((p) => [p.type, p.value]),
  );
  const wall = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
  return wall - Math.floor(at / 1000) * 1000;
}

