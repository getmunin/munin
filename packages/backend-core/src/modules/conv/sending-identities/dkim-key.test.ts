import { describe, expect, it } from 'vitest';
import { createPublicKey } from 'node:crypto';
import {
  DKIM_KEY_BITS,
  buildDkimSignOptions,
  dkimDnsRecord,
  dkimRecordName,
  dkimRecordValue,
  domainCoversAddress,
  extractPublicKeyFromRecord,
  generateDkimKeyPair,
  mintSelector,
  normaliseDomain,
  stripPem,
} from './dkim-key.ts';

describe('generateDkimKeyPair', () => {
  it('generates an RSA key within the range SES accepts', () => {
    const pair = generateDkimKeyPair();
    const key = createPublicKey(pair.publicKeyPem);
    expect(key.asymmetricKeyDetails?.modulusLength).toBe(DKIM_KEY_BITS);
    expect(DKIM_KEY_BITS).toBeGreaterThanOrEqual(1024);
    expect(DKIM_KEY_BITS).toBeLessThanOrEqual(2048);
  });

  it('emits PKCS8 private and SPKI public PEM', () => {
    const pair = generateDkimKeyPair();
    expect(pair.privateKeyPem).toContain('-----BEGIN PRIVATE KEY-----');
    expect(pair.publicKeyPem).toContain('-----BEGIN PUBLIC KEY-----');
  });

  it('mints a distinct selector per call', () => {
    const selectors = new Set(Array.from({ length: 20 }, () => mintSelector()));
    expect(selectors.size).toBe(20);
    for (const s of selectors) expect(s).toMatch(/^munin-[0-9a-f]{8}$/);
  });
});

describe('stripPem', () => {
  it('removes the header, footer, and every newline', () => {
    const pair = generateDkimKeyPair();
    const stripped = stripPem(pair.publicKeyPem);
    expect(stripped).not.toContain('-');
    expect(stripped).not.toContain('\n');
    expect(stripped).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});

describe('dkim record', () => {
  it('names the record under _domainkey on the customer domain', () => {
    expect(dkimRecordName('munin-a1b2c3d4', 'acme.com')).toBe('munin-a1b2c3d4._domainkey.acme.com');
  });

  it('never references the mail provider', () => {
    const pair = generateDkimKeyPair();
    const record = dkimDnsRecord(pair.selector, 'acme.com', pair.publicKeyPem);
    expect(record.value).not.toContain('amazonses');
    expect(record.value).not.toContain('amazonaws');
    expect(record.name).not.toContain('amazonses');
  });

  it('emits a v=DKIM1 rsa record carrying the public key', () => {
    const pair = generateDkimKeyPair();
    const value = dkimRecordValue(pair.publicKeyPem);
    expect(value.startsWith('v=DKIM1; k=rsa; p=')).toBe(true);
    expect(extractPublicKeyFromRecord(value)).toBe(stripPem(pair.publicKeyPem));
  });
});

describe('extractPublicKeyFromRecord', () => {
  it('reads the key back from a record with surrounding whitespace', () => {
    const pair = generateDkimKeyPair();
    const spaced = `v=DKIM1;  k=rsa;  p=${stripPem(pair.publicKeyPem)}`;
    expect(extractPublicKeyFromRecord(spaced)).toBe(stripPem(pair.publicKeyPem));
  });

  it('reads a key from a record split across strings by a DNS provider', () => {
    const pair = generateDkimKeyPair();
    const key = stripPem(pair.publicKeyPem);
    const chunked = `v=DKIM1; k=rsa; p=${key.slice(0, 100)}\n${key.slice(100)}`;
    expect(extractPublicKeyFromRecord(chunked)).toBe(key);
  });

  it('returns null when there is no p= tag', () => {
    expect(extractPublicKeyFromRecord('v=spf1 include:example.com ~all')).toBeNull();
  });

  it('returns null for a revoked key (empty p=)', () => {
    expect(extractPublicKeyFromRecord('v=DKIM1; k=rsa; p=')).toBeNull();
  });
});

describe('normaliseDomain', () => {
  it('lowercases and trims', () => {
    expect(normaliseDomain('  ACME.com ')).toBe('acme.com');
  });

  it('drops a leading @ and a trailing dot', () => {
    expect(normaliseDomain('@acme.com')).toBe('acme.com');
    expect(normaliseDomain('acme.com.')).toBe('acme.com');
  });

  it('rejects an email address, a bare label, and anything with spaces', () => {
    expect(normaliseDomain('support@acme.com')).toBeNull();
    expect(normaliseDomain('localhost')).toBeNull();
    expect(normaliseDomain('acme com')).toBeNull();
    expect(normaliseDomain('')).toBeNull();
  });
});

describe('domainCoversAddress', () => {
  it('covers an exact domain match', () => {
    expect(domainCoversAddress('acme.com', 'support@acme.com')).toBe(true);
    expect(domainCoversAddress('acme.com', 'Support@ACME.com')).toBe(true);
  });

  it('covers a subdomain', () => {
    expect(domainCoversAddress('acme.com', 'support@mail.acme.com')).toBe(true);
  });

  it('does not cover a suffix collision', () => {
    expect(domainCoversAddress('acme.com', 'support@notacme.com')).toBe(false);
  });

  it('does not cover an unrelated domain or a malformed address', () => {
    expect(domainCoversAddress('acme.com', 'support@example.com')).toBe(false);
    expect(domainCoversAddress('acme.com', 'not-an-address')).toBe(false);
  });
});

describe('buildDkimSignOptions', () => {
  it('maps a verified identity onto nodemailer dkim options', () => {
    const pair = generateDkimKeyPair('munin-a1b2c3d4');
    expect(
      buildDkimSignOptions({ domain: 'acme.com', selector: pair.selector }, pair.privateKeyPem),
    ).toEqual({
      domainName: 'acme.com',
      keySelector: 'munin-a1b2c3d4',
      privateKey: pair.privateKeyPem,
    });
  });

  it('refuses to sign when the key is missing or failed to decrypt', () => {
    expect(buildDkimSignOptions({ domain: 'acme.com', selector: 's' }, null)).toBeNull();
    expect(buildDkimSignOptions({ domain: 'acme.com', selector: 's' }, '')).toBeNull();
    expect(buildDkimSignOptions({ domain: 'acme.com', selector: 's' }, 'not-a-pem')).toBeNull();
  });
});

describe('nodemailer dkim compatibility', () => {
  it('signs a pre-built raw message, which is what the send path passes', async () => {
    const { createTransport } = await import('nodemailer');
    const pair = generateDkimKeyPair('munin-a1b2c3d4');
    const raw = [
      'From: Support <support@acme.com>',
      'To: customer@example.com',
      'Subject: Hello',
      'Message-ID: <abc@acme.com>',
      '',
      'Body text.',
      '',
    ].join('\r\n');

    const transport = createTransport({ streamTransport: true, buffer: true });
    const sent = (await transport.sendMail({
      envelope: { from: 'support@acme.com', to: 'customer@example.com' },
      raw,
      dkim: {
        keys: [
          buildDkimSignOptions(
            { domain: 'acme.com', selector: pair.selector },
            pair.privateKeyPem,
          )!,
        ],
      },
    })) as unknown as { message: Buffer };

    const output = sent.message.toString();
    expect(output).toContain('DKIM-Signature:');
    expect(output).toContain('d=acme.com');
    expect(output).toContain('s=munin-a1b2c3d4');
  });
});
