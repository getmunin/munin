import { describe, expect, it } from 'vitest';
import {
  customerIdentity,
  customerLabel,
  socialDraftTitle,
  SOCIAL_TITLE_MAX,
} from './inbox-helpers';

describe('customerIdentity', () => {
  it('is null when nothing identifies the customer, so callers can pick their own wording', () => {
    expect(customerIdentity({ name: null, email: null, phone: null })).toBeNull();
    expect(customerIdentity({})).toBeNull();
  });

  it('formats a phone-only caller', () => {
    expect(customerIdentity({ phone: '+4799999999' })).toBe('+47 99 99 99 99');
  });
});

describe('customerLabel', () => {
  it('prefers name, then email, then a formatted phone number', () => {
    expect(
      customerLabel({ name: 'Anders Vik', email: 'anders@example.com', phone: '+4799999999' }, '—'),
    ).toBe('Anders Vik');
    expect(customerLabel({ email: 'anders@example.com', phone: '+4799999999' }, '—')).toBe(
      'anders@example.com',
    );
    expect(customerLabel({ phone: '+4799999999' }, '—')).toBe('+47 99 99 99 99');
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

describe('socialDraftTitle', () => {
  it('takes the opening line as the title', () => {
    expect(socialDraftTitle('Nine in ten tickets.\n\nThe rest is detail.', 'fallback')).toBe(
      'Nine in ten tickets.',
    );
  });

  it('skips leading blank lines rather than titling a draft empty', () => {
    expect(socialDraftTitle('\n\n  A late start.', 'fallback')).toBe('A late start.');
  });

  it('falls back when there is nothing but whitespace', () => {
    expect(socialDraftTitle('   \n  \n', 'Untitled draft')).toBe('Untitled draft');
  });

  it('clips a long opening line on a word boundary', () => {
    const body = `${'word '.repeat(40)}end`;
    const title = socialDraftTitle(body, 'fallback');
    expect(title.length).toBeLessThanOrEqual(SOCIAL_TITLE_MAX + 1);
    expect(title.endsWith('…')).toBe(true);
    expect(title).not.toContain('  ');
  });

  it('clips mid-word only when the first word is longer than the budget', () => {
    const title = socialDraftTitle('x'.repeat(200), 'fallback');
    expect(title).toBe(`${'x'.repeat(SOCIAL_TITLE_MAX)}…`);
  });
});
