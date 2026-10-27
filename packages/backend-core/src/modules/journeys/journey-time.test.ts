import { describe, expect, it } from 'vitest';
import { nextLocalOccurrence } from './journey-time.ts';

describe('nextLocalOccurrence', () => {
  it('finds the next wall-clock time in the given time zone', () => {
    const at = nextLocalOccurrence(new Date('2026-10-27T14:47:00Z'), '09:00', 'Europe/Oslo', null);
    expect(at.toISOString()).toBe('2026-10-28T08:00:00.000Z');
  });

  it('moves to the chosen weekday and keeps local time across a daylight-saving change', () => {
    const at = nextLocalOccurrence(new Date('2026-10-23T12:00:00Z'), '09:00', 'Europe/Oslo', 'mon');
    expect(at.toISOString()).toBe('2026-10-26T08:00:00.000Z');
    const summer = nextLocalOccurrence(new Date('2026-10-23T12:00:00Z'), '09:00', 'Europe/Oslo', 'sat');
    expect(summer.toISOString()).toBe('2026-10-24T07:00:00.000Z');
  });

  it('never returns the current minute', () => {
    const at = nextLocalOccurrence(new Date('2026-10-28T08:00:00Z'), '09:00', 'Europe/Oslo', null);
    expect(at.toISOString()).toBe('2026-10-29T08:00:00.000Z');
  });
});
