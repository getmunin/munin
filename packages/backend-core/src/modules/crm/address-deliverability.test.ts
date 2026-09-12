import { describe, expect, it } from 'vitest';
import {
  classifySmtpFailure,
  nextDeliverability,
  normalizeAddress,
  SOFT_FAILURES_BEFORE_UNDELIVERABLE,
  SOFT_FAILURE_WINDOW_DAYS,
  type DeliverabilitySnapshot,
} from './address-deliverability.ts';

const NOW = new Date('2026-09-12T10:00:00Z');

function snapshot(overrides: Partial<DeliverabilitySnapshot> = {}): DeliverabilitySnapshot {
  return {
    state: 'valid',
    reason: null,
    failureCount: 0,
    lastFailureAt: null,
    ...overrides,
  };
}

function daysBefore(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

describe('normalizeAddress', () => {
  it('lowercases and unwraps angle brackets and mailto', () => {
    expect(normalizeAddress('  <MAILTO:Ola.Nordmann@Example.NO> ')).toBe('ola.nordmann@example.no');
  });

  it('rejects anything that is not an address', () => {
    for (const raw of [null, undefined, '', 'not-an-address', 'a@b', 'a b@example.com']) {
      expect(normalizeAddress(raw)).toBeNull();
    }
  });
});

describe('nextDeliverability', () => {
  it('condemns an address on the first hard signal', () => {
    expect(nextDeliverability(null, { severity: 'hard', reason: 'hard_bounce' }, NOW)).toEqual({
      state: 'undeliverable',
      reason: 'hard_bounce',
      failureCount: 1,
    });
  });

  it('marks a first soft signal as soft_failing, not undeliverable', () => {
    expect(nextDeliverability(null, { severity: 'soft', reason: 'no_reply_notice' }, NOW)).toEqual({
      state: 'soft_failing',
      reason: 'no_reply_notice',
      failureCount: 1,
    });
  });

  it('promotes to undeliverable only after enough soft failures inside the window', () => {
    const current = snapshot({
      state: 'soft_failing',
      reason: 'delivery_dead',
      failureCount: SOFT_FAILURES_BEFORE_UNDELIVERABLE - 1,
      lastFailureAt: daysBefore(1),
    });
    expect(nextDeliverability(current, { severity: 'soft', reason: 'delivery_dead' }, NOW)).toEqual({
      state: 'undeliverable',
      reason: 'repeated_soft_failure',
      failureCount: SOFT_FAILURES_BEFORE_UNDELIVERABLE,
    });
  });

  it('restarts the count when the last soft failure fell outside the window', () => {
    const current = snapshot({
      state: 'soft_failing',
      reason: 'delivery_dead',
      failureCount: SOFT_FAILURES_BEFORE_UNDELIVERABLE - 1,
      lastFailureAt: daysBefore(SOFT_FAILURE_WINDOW_DAYS + 1),
    });
    expect(nextDeliverability(current, { severity: 'soft', reason: 'delivery_dead' }, NOW)).toEqual({
      state: 'soft_failing',
      reason: 'delivery_dead',
      failureCount: 1,
    });
  });

  it('keeps the original reason when a soft signal lands on an already-undeliverable address', () => {
    const current = snapshot({
      state: 'undeliverable',
      reason: 'hard_bounce',
      failureCount: 2,
      lastFailureAt: daysBefore(2),
    });
    expect(nextDeliverability(current, { severity: 'soft', reason: 'no_reply_notice' }, NOW)).toEqual({
      state: 'undeliverable',
      reason: 'hard_bounce',
      failureCount: 3,
    });
  });

  it('starts a cleared address over rather than resuming its old count', () => {
    const cleared = snapshot({ state: 'valid', reason: 'cleared', failureCount: 0, lastFailureAt: null });
    expect(nextDeliverability(cleared, { severity: 'soft', reason: 'delivery_dead' }, NOW)).toEqual({
      state: 'soft_failing',
      reason: 'delivery_dead',
      failureCount: 1,
    });
  });
});

describe('classifySmtpFailure', () => {
  it('reads a permanent recipient rejection as hard evidence', () => {
    expect(classifySmtpFailure('550 5.1.1 <ola@example.no>: Recipient address rejected')).toBe('hard');
    expect(classifySmtpFailure('Message rejected: 5.1.10 RESOLVER.ADR.RecipientNotFound')).toBe('hard');
    expect(classifySmtpFailure('550 User unknown in virtual mailbox table')).toBe('hard');
  });

  it('reads a full mailbox as soft — the address is real, the box is not empty', () => {
    expect(classifySmtpFailure('452 4.2.2 Mailbox full')).toBe('soft');
    expect(classifySmtpFailure('550 5.2.2 The recipient is over quota')).toBe('soft');
  });

  it('learns nothing about the address from a failure on our side of the wire', () => {
    for (const error of [
      'connect ETIMEDOUT 10.0.0.1:587',
      'getaddrinfo ENOTFOUND smtp.example.test',
      '535 5.7.8 Authentication credentials invalid',
      '550 5.7.1 Message rejected due to content policy',
      '421 4.7.0 Too many connections from your host',
      "no adapter registered for channel 'email:smtp'",
      null,
    ]) {
      expect(classifySmtpFailure(error)).toBe('inconclusive');
    }
  });
});
