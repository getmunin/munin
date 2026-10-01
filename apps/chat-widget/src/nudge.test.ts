import { describe, it, expect, beforeEach } from 'vitest';
import { isNudgeSnoozed, NUDGE_SNOOZE_MS, snoozeNudge } from './nudge.ts';

describe('nudge snooze', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('is not snoozed for a channel that was never dismissed', () => {
    expect(isNudgeSnoozed('cch_never')).toBe(false);
  });

  it('stays snoozed inside the window and expires after it', () => {
    const t0 = 1_700_000_000_000;
    snoozeNudge('cch_window', t0);
    expect(isNudgeSnoozed('cch_window', t0 + NUDGE_SNOOZE_MS - 1)).toBe(true);
    expect(isNudgeSnoozed('cch_window', t0 + NUDGE_SNOOZE_MS)).toBe(false);
  });

  it('persists the snooze to localStorage per channel', () => {
    snoozeNudge('cch_persist', 1234);
    expect(localStorage.getItem('munin-widget-nudge-snoozed:cch_persist')).toBe('1234');
    expect(isNudgeSnoozed('cch_other', 1234)).toBe(false);
  });

  it('reads a snooze written by an earlier page load', () => {
    const now = Date.now();
    localStorage.setItem('munin-widget-nudge-snoozed:cch_earlier', String(now - 1000));
    expect(isNudgeSnoozed('cch_earlier', now)).toBe(true);
  });

  it('ignores a corrupt stored value', () => {
    localStorage.setItem('munin-widget-nudge-snoozed:cch_corrupt', 'garbage');
    expect(isNudgeSnoozed('cch_corrupt')).toBe(false);
  });
});
