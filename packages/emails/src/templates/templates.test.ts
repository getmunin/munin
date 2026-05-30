import { describe, it, expect } from 'vitest';
import {
  renderChannelTestEmail,
  renderDeleteAccountEmail,
  renderOrgInviteEmail,
  renderPartnerClaimEmail,
  renderResetPasswordEmail,
  renderVerifyEmail,
} from '../index.ts';

const url = 'https://app.example/path?token=abc';

function assertCommon(out: { subject: string; html: string; text: string }) {
  expect(out.subject.length).toBeGreaterThan(0);
  expect(out.html.length).toBeGreaterThan(0);
  expect(out.text.length).toBeGreaterThan(0);
  expect(out.html).toContain('<html');
  expect(out.html).toContain('</html>');
}

describe('reset-password', () => {
  it('renders en + nb with the same URL', async () => {
    const en = await renderResetPasswordEmail({ url, locale: 'en' });
    const nb = await renderResetPasswordEmail({ url, locale: 'nb' });
    assertCommon(en);
    assertCommon(nb);
    expect(en.html).toContain(url);
    expect(en.text).toContain(url);
    expect(en.subject).toBe('Reset your Munin password');
    expect(nb.subject).toBe('Tilbakestill Munin-passordet ditt');
    expect(en.html).not.toBe(nb.html);
  });

  it('greets by name when provided', async () => {
    const named = await renderResetPasswordEmail({ url, recipientName: 'Anna', locale: 'en' });
    expect(named.text).toContain('Hi Anna');
  });
});

describe('verify-email', () => {
  it('renders en + nb', async () => {
    const en = await renderVerifyEmail({ url, locale: 'en' });
    const nb = await renderVerifyEmail({ url, locale: 'nb' });
    assertCommon(en);
    assertCommon(nb);
    expect(en.subject).toBe('Verify your Munin email');
    expect(nb.subject).toBe('Bekreft Munin-e-postadressen din');
  });
});

describe('delete-account', () => {
  it('renders en + nb', async () => {
    const en = await renderDeleteAccountEmail({ url, locale: 'en' });
    const nb = await renderDeleteAccountEmail({ url, locale: 'nb' });
    assertCommon(en);
    assertCommon(nb);
    expect(en.subject).toBe('Confirm Munin account deletion');
    expect(nb.subject).toBe('Bekreft sletting av Munin-konto');
  });
});

describe('org-invite', () => {
  it('inlines org and inviter name', async () => {
    const out = await renderOrgInviteEmail({
      acceptUrl: url,
      orgName: 'Acme Support',
      inviterName: 'Anna Jensen',
      locale: 'en',
    });
    assertCommon(out);
    expect(out.subject).toBe("You've been invited to Acme Support on Munin");
    expect(out.text).toContain('Anna Jensen');
    expect(out.text).toContain('Acme Support');
  });

  it('skips inviter prefix when name is null', async () => {
    const out = await renderOrgInviteEmail({
      acceptUrl: url,
      orgName: 'Acme Support',
      locale: 'en',
    });
    expect(out.text).not.toContain('null');
    expect(out.text).toMatch(/^You've been invited/);
  });

  it('localizes to nb', async () => {
    const out = await renderOrgInviteEmail({
      acceptUrl: url,
      orgName: 'Acme Support',
      inviterName: 'Anna Jensen',
      locale: 'nb',
    });
    expect(out.subject).toBe('Du er invitert til Acme Support på Munin');
    expect(out.text).toContain('har invitert deg');
  });
});

describe('channel-test', () => {
  it('renders diagnostic block with channel + address', async () => {
    const out = await renderChannelTestEmail({
      channelName: 'Support inbox',
      channelAddress: 'support@acme.example',
      messageId: 'msg-123@example',
      locale: 'en',
    });
    assertCommon(out);
    expect(out.html).toContain('Support inbox');
    expect(out.html).toContain('support@acme.example');
    expect(out.html).toContain('msg-123@example');
  });
});

describe('partner-claim', () => {
  it('inlines partner + customer org', async () => {
    const out = await renderPartnerClaimEmail({
      claimUrl: url,
      partnerName: 'Nordvik Digital',
      customerOrgName: 'Nordvik AS',
      locale: 'en',
    });
    assertCommon(out);
    expect(out.text).toContain('Nordvik Digital');
    expect(out.text).toContain('Nordvik AS');
  });

  it('localizes to nb', async () => {
    const out = await renderPartnerClaimEmail({
      claimUrl: url,
      partnerName: 'Nordvik Digital',
      customerOrgName: 'Nordvik AS',
      locale: 'nb',
    });
    expect(out.subject).toBe('Krev Munin-kontoen din');
    expect(out.text).toContain('har satt opp et Munin-arbeidsområde');
  });
});

describe('plain-text bodies never contain raw HTML tags', () => {
  it.each([
    ['reset', () => renderResetPasswordEmail({ url, locale: 'en' })],
    ['verify', () => renderVerifyEmail({ url, locale: 'en' })],
    ['delete', () => renderDeleteAccountEmail({ url, locale: 'en' })],
    ['invite', () => renderOrgInviteEmail({ acceptUrl: url, orgName: 'X', locale: 'en' })],
    [
      'test',
      () => renderChannelTestEmail({ channelName: 'X', channelAddress: 'a@b.c', locale: 'en' }),
    ],
    [
      'partner',
      () =>
        renderPartnerClaimEmail({
          claimUrl: url,
          partnerName: 'X',
          customerOrgName: 'Y',
          locale: 'en',
        }),
    ],
  ])('%s', async (_name, fn) => {
    const out = await fn();
    expect(out.text).not.toMatch(/<[a-z]+[\s>]/i);
  });
});
