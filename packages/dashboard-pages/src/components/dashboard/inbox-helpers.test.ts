import { describe, expect, it } from 'vitest';
import { customerIdentity, customerLabel } from './inbox-helpers';

describe('customerIdentity', () => {
  it('is null when nothing identifies the customer, so callers can pick their own wording', () => {
    expect(customerIdentity({ name: null, email: null, phone: null })).toBeNull();
    expect(customerIdentity({})).toBeNull();
  });

  it('formats a phone-only caller', () => {
    expect(customerIdentity({ phone: '+4795039493' })).toBe('+47 95 03 94 93');
  });
});

describe('customerLabel', () => {
  it('prefers name, then email, then a formatted phone number', () => {
    expect(
      customerLabel({ name: 'Anders Vik', email: 'anders@example.com', phone: '+4795039493' }, '—'),
    ).toBe('Anders Vik');
    expect(customerLabel({ email: 'anders@example.com', phone: '+4795039493' }, '—')).toBe(
      'anders@example.com',
    );
    expect(customerLabel({ phone: '+4795039493' }, '—')).toBe('+47 95 03 94 93');
  });

  it('keeps an unparseable phone number as written rather than dropping it', () => {
    expect(customerLabel({ phone: '12345' }, '—')).toBe('12345');
  });

  it('falls back when nothing identifies the customer', () => {
    expect(customerLabel({ name: null, email: null, phone: null }, 'Anonymous visitor')).toBe(
      'Anonymous visitor',
    );
  });
});
