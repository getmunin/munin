import { describe, it, expect, beforeAll } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';
import { verifyBotFrameworkToken, type BotFrameworkKey } from './teams-auth.ts';

const APP_ID = '11111111-2222-3333-4444-555555555555';
const SERVICE_URL = 'https://smba.trafficmanager.net/emea/';
const KID = 'test-key';

type PrivateKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

let privateKey: PrivateKey;
let publicJwk: JWK;
let otherPrivateKey: PrivateKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  publicJwk = await exportJWK(pair.publicKey);
  otherPrivateKey = (await generateKeyPair('RS256')).privateKey;
});

function keys(endorsements: string[] = ['msteams']) {
  return {
    resolve: (kid: string): Promise<BotFrameworkKey | null> =>
      Promise.resolve(kid === KID ? { jwk: publicJwk, endorsements } : null),
  };
}

async function token(
  overrides: {
    issuer?: string;
    audience?: string;
    serviceurl?: string | null;
    kid?: string;
    signWith?: PrivateKey;
  } = {},
): Promise<string> {
  const claims: Record<string, unknown> = {};
  if (overrides.serviceurl !== null) claims.serviceurl = overrides.serviceurl ?? SERVICE_URL;
  return await new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: overrides.kid ?? KID })
    .setIssuer(overrides.issuer ?? 'https://api.botframework.com')
    .setAudience(overrides.audience ?? APP_ID)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(overrides.signWith ?? privateKey);
}

function verify(authorization: unknown, opts: { endorsements?: string[]; serviceUrl?: string } = {}) {
  return verifyBotFrameworkToken({
    authorization,
    activityServiceUrl: opts.serviceUrl ?? SERVICE_URL,
    isKnownAppId: (appId) => Promise.resolve(appId === APP_ID),
    keys: keys(opts.endorsements),
  });
}

describe('verifyBotFrameworkToken', () => {
  it('accepts a Bot Connector token for a known bot and returns its app id', async () => {
    await expect(verify(`Bearer ${await token()}`)).resolves.toEqual({ ok: true, appId: APP_ID });
  });

  it('treats a trailing slash difference in the service url as the same endpoint', async () => {
    const result = await verify(`Bearer ${await token()}`, {
      serviceUrl: 'https://smba.trafficmanager.net/emea',
    });
    expect(result.ok).toBe(true);
  });

  it.each([
    ['missing header', undefined, 'missing_token'],
    ['non-bearer scheme', 'Basic abc', 'missing_token'],
    ['garbage token', 'Bearer not-a-jwt', 'malformed_token'],
  ])('rejects %s', async (_label, header, reason) => {
    await expect(verify(header)).resolves.toEqual({ ok: false, reason });
  });

  it('rejects a token signed by a key that is not in the published key set', async () => {
    const result = await verify(`Bearer ${await token({ kid: 'rotated-away' })}`);
    expect(result).toEqual({ ok: false, reason: 'unknown_key' });
  });

  it('rejects a key that is not endorsed for the msteams channel', async () => {
    const result = await verify(`Bearer ${await token()}`, { endorsements: ['skype'] });
    expect(result).toEqual({ ok: false, reason: 'key_not_endorsed' });
  });

  it('rejects a forged signature under a published kid', async () => {
    const result = await verify(`Bearer ${await token({ signWith: otherPrivateKey })}`);
    expect(result).toEqual({ ok: false, reason: 'invalid_signature_or_claims' });
  });

  it('rejects a token from another issuer', async () => {
    const result = await verify(`Bearer ${await token({ issuer: 'https://sts.windows.net/x/' })}`);
    expect(result).toEqual({ ok: false, reason: 'invalid_signature_or_claims' });
  });

  it('rejects an expired token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = await new SignJWT({ serviceurl: SERVICE_URL })
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setIssuer('https://api.botframework.com')
      .setAudience(APP_ID)
      .setIssuedAt(now - 3600)
      .setExpirationTime(now - 1800)
      .sign(privateKey);
    const result = await verify(`Bearer ${expired}`);
    expect(result).toEqual({ ok: false, reason: 'invalid_signature_or_claims' });
  });

  it('rejects a token minted for a bot no org has connected', async () => {
    const result = await verify(
      `Bearer ${await token({ audience: '99999999-2222-3333-4444-555555555555' })}`,
    );
    expect(result).toEqual({ ok: false, reason: 'unknown_audience' });
  });

  it('rejects an activity whose serviceUrl differs from the one the token was issued for', async () => {
    const result = await verify(`Bearer ${await token()}`, {
      serviceUrl: 'https://smba.trafficmanager.net/amer/',
    });
    expect(result).toEqual({ ok: false, reason: 'service_url_mismatch' });
  });

  it('rejects a token without a serviceurl claim', async () => {
    const result = await verify(`Bearer ${await token({ serviceurl: null })}`);
    expect(result).toEqual({ ok: false, reason: 'service_url_mismatch' });
  });
});
