import { describe, expect, it } from 'vitest';
import { firstName, greetingKey } from './dashboard-hero';

describe('firstName', () => {
  it('takes the first token of a full name', () => {
    expect(firstName('Kjell Rune Monsø')).toBe('Kjell');
  });

  it('returns null for a missing name so the hero keeps its unpersonalized headline', () => {
    expect(firstName(null)).toBeNull();
    expect(firstName(undefined)).toBeNull();
    expect(firstName('   ')).toBeNull();
  });

  it('refuses an email so the greeting never addresses someone by their address', () => {
    expect(firstName('kjell@apps.no')).toBeNull();
  });

  it('refuses an implausibly long first token rather than overflowing the headline', () => {
    expect(firstName('a'.repeat(25))).toBeNull();
    expect(firstName('a'.repeat(24))).toBe('a'.repeat(24));
  });
});

describe('greetingKey', () => {
  it('splits the day at five, noon and six', () => {
    expect(greetingKey(new Date(2026, 8, 2, 0, 0))).toBe('greetingLateNight');
    expect(greetingKey(new Date(2026, 8, 2, 4, 59))).toBe('greetingLateNight');
    expect(greetingKey(new Date(2026, 8, 2, 5, 0))).toBe('greetingMorning');
    expect(greetingKey(new Date(2026, 8, 2, 11, 59))).toBe('greetingMorning');
    expect(greetingKey(new Date(2026, 8, 2, 12, 0))).toBe('greetingAfternoon');
    expect(greetingKey(new Date(2026, 8, 2, 17, 59))).toBe('greetingAfternoon');
    expect(greetingKey(new Date(2026, 8, 2, 18, 0))).toBe('greetingEvening');
    expect(greetingKey(new Date(2026, 8, 2, 23, 59))).toBe('greetingEvening');
  });
});
