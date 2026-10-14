import { describe, expect, it } from 'vitest';
import { judgeOwnContact } from './own-contact.ts';

const attested = { emailSource: 'org-attested' };

describe('judgeOwnContact', () => {
  it('accepts a contact whose email and phone match the end user', () => {
    expect(
      judgeOwnContact(
        { email: 'kari@example.com', phone: '+4712345678', metadata: attested },
        { email: ' Kari@Example.com ', phone: '+47 12 34 56 78' },
      ),
    ).toBe('ok');
  });

  it('accepts a contact that carries neither email nor phone', () => {
    expect(
      judgeOwnContact({ email: null, phone: null, metadata: {} }, { email: null, phone: null }),
    ).toBe('ok');
  });

  it('refuses an end user whose email was typed by a visitor', () => {
    expect(
      judgeOwnContact(
        { email: 'kari@example.com', phone: null, metadata: { emailSource: 'visitor' } },
        { email: 'kari@example.com', phone: null },
      ),
    ).toBe('self_reported');
  });

  it('refuses an anonymous end user', () => {
    expect(
      judgeOwnContact({ email: null, phone: null, metadata: { anonymous: true } }, { email: null, phone: null }),
    ).toBe('self_reported');
  });

  it('refuses a contact keyed on an email the end user does not carry', () => {
    expect(
      judgeOwnContact({ email: null, phone: null, metadata: {} }, { email: 'kari@example.com', phone: null }),
    ).toBe('email_unproven');
    expect(
      judgeOwnContact(
        { email: 'ola@example.com', phone: null, metadata: attested },
        { email: 'kari@example.com', phone: null },
      ),
    ).toBe('email_unproven');
  });

  it('keys on the email when the contact has one, so a phone the end user lacks does not matter', () => {
    expect(
      judgeOwnContact(
        { email: 'kari@example.com', phone: null, metadata: attested },
        { email: 'kari@example.com', phone: '+4712345678' },
      ),
    ).toBe('ok');
  });

  it('refuses an email-less contact keyed on a phone the end user does not carry', () => {
    expect(
      judgeOwnContact({ email: null, phone: null, metadata: {} }, { email: null, phone: '+4712345678' }),
    ).toBe('phone_unproven');
    expect(
      judgeOwnContact(
        { email: null, phone: '+4701234567', metadata: {} },
        { email: null, phone: '+4712345678' },
      ),
    ).toBe('phone_unproven');
  });
});
