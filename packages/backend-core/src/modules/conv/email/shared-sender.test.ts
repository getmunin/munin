import { describe, expect, it } from 'vitest';
import {
  channelSender,
  composeFrom,
  orgFromAddressAllowed,
  parseMailbox,
  readOrgFromDomainPolicy,
  sharedMailerSender,
} from './shared-sender.ts';

const DEPLOYMENT_FROM = 'Munin <no-reply@munin.example.test>';

describe('readOrgFromDomainPolicy', () => {
  it('allows no domain when unset or blank', () => {
    expect(orgFromAddressAllowed('support@acme.test', readOrgFromDomainPolicy(undefined))).toBe(false);
    expect(orgFromAddressAllowed('support@acme.test', readOrgFromDomainPolicy(' , '))).toBe(false);
  });

  it('matches listed domains exactly and case-insensitively', () => {
    const policy = readOrgFromDomainPolicy(' ACME.test ,@globex.test, ');
    expect(orgFromAddressAllowed('Support@Acme.Test', policy)).toBe(true);
    expect(orgFromAddressAllowed('sales@globex.test', policy)).toBe(true);
    expect(orgFromAddressAllowed('support@mail.acme.test', policy)).toBe(false);
    expect(orgFromAddressAllowed('support@acme.test.evil.test', policy)).toBe(false);
    expect(orgFromAddressAllowed('not-an-address', policy)).toBe(false);
  });

  it('allows every address with a literal *', () => {
    const policy = readOrgFromDomainPolicy('example.test, *');
    expect(orgFromAddressAllowed('anyone@anywhere.test', policy)).toBe(true);
  });
});

describe('sharedMailerSender', () => {
  it('sends as the channel address when its domain is allowed', () => {
    const sender = sharedMailerSender(
      DEPLOYMENT_FROM,
      { fromAddress: 'support@acme.test', fromName: 'Acme Support' },
      readOrgFromDomainPolicy('acme.test'),
    );
    expect(sender).toEqual({
      from: 'Acme Support <support@acme.test>',
      address: 'support@acme.test',
      usesDeploymentSender: false,
    });
  });

  it('sends as the deployment address with the channel name and a Reply-To when the domain is not allowed', () => {
    const sender = sharedMailerSender(
      DEPLOYMENT_FROM,
      { fromAddress: 'support@acme.test', fromName: 'Acme Support' },
      readOrgFromDomainPolicy(undefined),
    );
    expect(sender).toEqual({
      from: 'Acme Support <no-reply@munin.example.test>',
      address: 'no-reply@munin.example.test',
      fallbackReplyTo: 'support@acme.test',
      usesDeploymentSender: true,
    });
  });

  it('never lets a channel send as an address on the deployment domain unless that domain is listed', () => {
    const sender = sharedMailerSender(
      DEPLOYMENT_FROM,
      { fromAddress: 'security@munin.example.test', fromName: 'Security' },
      readOrgFromDomainPolicy('acme.test'),
    );
    expect(sender.address).toBe('no-reply@munin.example.test');
    expect(sender.usesDeploymentSender).toBe(true);
  });

  it('falls back to the deployment display name when the channel has none', () => {
    const sender = sharedMailerSender(
      DEPLOYMENT_FROM,
      { fromAddress: 'support@acme.test' },
      readOrgFromDomainPolicy(undefined),
    );
    expect(sender.from).toBe('Munin <no-reply@munin.example.test>');
  });

  it('keeps an angle-bracketed address out of the display name', () => {
    const sender = sharedMailerSender(
      'no-reply@munin.example.test',
      { fromAddress: 'support@acme.test', fromName: 'Support <security@munin.example.test>' },
      readOrgFromDomainPolicy(undefined),
    );
    expect(sender.from).not.toContain('<security@');
    expect(parseMailbox(sender.from).address).toBe('no-reply@munin.example.test');
  });
});

describe('channelSender', () => {
  it('leaves an SMTP channel on its own address whatever the shared-mailer policy', () => {
    const sender = channelSender(
      {
        addressing: { fromAddress: 'support@acme.test', fromName: 'Acme Support' },
        outbound: { provider: 'smtp' },
      },
      DEPLOYMENT_FROM,
    );
    expect(sender).toEqual({
      from: 'Acme Support <support@acme.test>',
      address: 'support@acme.test',
      usesDeploymentSender: false,
    });
  });
});

describe('parseMailbox and composeFrom', () => {
  it('splits a display name from its address', () => {
    expect(parseMailbox('"Munin Team" <no-reply@munin.example.test>')).toEqual({
      name: 'Munin Team',
      address: 'no-reply@munin.example.test',
    });
    expect(parseMailbox('no-reply@munin.example.test')).toEqual({
      name: null,
      address: 'no-reply@munin.example.test',
    });
  });

  it('drops header-breaking characters from the display name', () => {
    expect(composeFrom('Acme, "Support"\r\n', 'support@acme.test')).toBe(
      'Acme Support <support@acme.test>',
    );
    expect(composeFrom('  ', 'support@acme.test')).toBe('support@acme.test');
  });
});
