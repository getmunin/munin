import { afterEach, describe, expect, it } from 'vitest';
import { mailerCanSendAs, readMailerSendingDomains } from './email.service.ts';

const ORIGINAL = process.env.MUNIN_MAIL_SENDING_DOMAINS;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.MUNIN_MAIL_SENDING_DOMAINS;
  else process.env.MUNIN_MAIL_SENDING_DOMAINS = ORIGINAL;
});

describe('readMailerSendingDomains', () => {
  it('is empty when unset', () => {
    delete process.env.MUNIN_MAIL_SENDING_DOMAINS;
    expect(readMailerSendingDomains()).toEqual([]);
  });

  it('splits, trims, lowercases, and drops a leading @', () => {
    process.env.MUNIN_MAIL_SENDING_DOMAINS = ' @GetMunin.com , mail.example.com ,, ';
    expect(readMailerSendingDomains()).toEqual(['getmunin.com', 'mail.example.com']);
  });
});

describe('mailerCanSendAs', () => {
  it('allows any address when no allowlist is configured', () => {
    delete process.env.MUNIN_MAIL_SENDING_DOMAINS;
    expect(mailerCanSendAs('support@acme.test')).toBe(true);
  });

  it('allows an exact domain match', () => {
    process.env.MUNIN_MAIL_SENDING_DOMAINS = 'getmunin.com';
    expect(mailerCanSendAs('no-reply@getmunin.com')).toBe(true);
    expect(mailerCanSendAs('No-Reply@GetMunin.com')).toBe(true);
  });

  it('allows a subdomain of an allowed domain', () => {
    process.env.MUNIN_MAIL_SENDING_DOMAINS = 'getmunin.com';
    expect(mailerCanSendAs('acme@mail.getmunin.com')).toBe(true);
  });

  it('refuses a customer domain the platform cannot send as', () => {
    process.env.MUNIN_MAIL_SENDING_DOMAINS = 'getmunin.com';
    expect(mailerCanSendAs('support@acme.test')).toBe(false);
  });

  it('does not treat a suffix collision as a subdomain', () => {
    process.env.MUNIN_MAIL_SENDING_DOMAINS = 'munin.com';
    expect(mailerCanSendAs('support@getmunin.com')).toBe(false);
  });

  it('refuses a value with no domain part', () => {
    process.env.MUNIN_MAIL_SENDING_DOMAINS = 'getmunin.com';
    expect(mailerCanSendAs('not-an-address')).toBe(false);
  });
});
