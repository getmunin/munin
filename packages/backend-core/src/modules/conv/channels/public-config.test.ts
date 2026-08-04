import { describe, it, expect } from 'vitest';
import { publicChannelConfig, CHANNEL_SECRET_MASK } from './public-config.ts';

const CIPHERTEXT = '\\xc30d0402030296b3fake-pgcrypto-ciphertext';

const STORED_CONFIGS: Array<{ vendor: string; config: Record<string, unknown> }> = [
  {
    vendor: 'twilio',
    config: {
      accountSid: 'AC00000000000000000000000000000000',
      encryptedAuthToken: CIPHERTEXT,
      fromNumber: '+15005550006',
    },
  },
  {
    vendor: 'messagebird',
    config: {
      encryptedAccessKey: CIPHERTEXT,
      encryptedSigningKey: CIPHERTEXT,
      originator: 'Munin',
    },
  },
  {
    vendor: 'vapi',
    config: {
      encryptedApiKey: CIPHERTEXT,
      encryptedWebhookSecret: CIPHERTEXT,
      assistantId: 'asst_1',
      phoneNumberId: 'pn_1',
      managedWebhook: true,
      priorAssistantServer: { url: 'https://vendor.example/hook' },
    },
  },
  {
    vendor: 'threll',
    config: {
      encryptedApiKey: CIPHERTEXT,
      encryptedWebhookSecret: CIPHERTEXT,
      accountId: 'acct_1',
      workerId: 'wrk_1',
    },
  },
  {
    vendor: 'smtp',
    config: {
      addressing: { fromAddress: 'support@example.com', fromName: 'Support' },
      outbound: {
        provider: 'smtp',
        host: 'smtp.example.com',
        port: 587,
        secure: true,
        username: 'support@example.com',
        encryptedPassword: CIPHERTEXT,
      },
      inbound: {
        provider: 'imap',
        host: 'imap.example.com',
        port: 993,
        secure: true,
        username: 'support@example.com',
        encryptedPassword: CIPHERTEXT,
        mailbox: 'INBOX',
      },
    },
  },
  {
    vendor: 'munin',
    config: {
      provider: 'widget',
      originAllowlist: ['https://example.com'],
      identityVerificationSecret: 'a'.repeat(64),
      requireVerifiedIdentity: true,
    },
  },
];

function secretKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(secretKeys);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => [
    ...(key.startsWith('encrypted') || key === 'identityVerificationSecret' ? [key] : []),
    ...secretKeys(nested),
  ]);
}

describe('publicChannelConfig', () => {
  for (const { vendor, config } of STORED_CONFIGS) {
    it(`keeps no secret material in the ${vendor} config it surfaces`, () => {
      const surfaced = publicChannelConfig(config);
      expect(secretKeys(surfaced)).toEqual([]);
      expect(JSON.stringify(surfaced)).not.toContain(CIPHERTEXT);
      expect(JSON.stringify(surfaced)).not.toContain('a'.repeat(64));
    });
  }

  it('masks a stored ciphertext under its plaintext field name', () => {
    expect(publicChannelConfig({ accountSid: 'AC1', encryptedAuthToken: CIPHERTEXT })).toEqual({
      accountSid: 'AC1',
      authToken: CHANNEL_SECRET_MASK,
    });
  });

  it('masks nested ciphertext and leaves the rest of the branch intact', () => {
    const surfaced = publicChannelConfig({
      outbound: { provider: 'smtp', host: 'smtp.example.com', encryptedPassword: CIPHERTEXT },
    });
    expect(surfaced.outbound).toEqual({
      provider: 'smtp',
      host: 'smtp.example.com',
      password: CHANNEL_SECRET_MASK,
    });
  });

  it('surfaces an empty secret as unset rather than masked', () => {
    expect(publicChannelConfig({ outbound: { encryptedPassword: '' } })).toEqual({
      outbound: { password: '' },
    });
  });

  it('reduces the widget identity secret to a presence flag', () => {
    expect(
      publicChannelConfig({ provider: 'widget', identityVerificationSecret: 'a'.repeat(64) }),
    ).toEqual({ provider: 'widget', hasIdentityVerificationSecret: true });
    expect(publicChannelConfig({ provider: 'widget' })).toEqual({ provider: 'widget' });
  });

  it('walks arrays of objects', () => {
    expect(publicChannelConfig({ senders: [{ id: 'a', encryptedApiKey: CIPHERTEXT }] })).toEqual({
      senders: [{ id: 'a', apiKey: CHANNEL_SECRET_MASK }],
    });
  });

  it('leaves a pending setup marker readable', () => {
    expect(publicChannelConfig({ pendingSetup: { originator: 'Munin' } })).toEqual({
      pendingSetup: { originator: 'Munin' },
    });
  });

  it('returns an empty object for a non-object config', () => {
    expect(publicChannelConfig(null)).toEqual({});
    expect(publicChannelConfig('nope')).toEqual({});
  });
});
