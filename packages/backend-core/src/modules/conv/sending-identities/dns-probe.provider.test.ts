import { beforeEach, describe, expect, it } from 'vitest';
import { DnsProbeSendingIdentityProvider } from './dns-probe.provider.ts';
import { dkimRecordValue, generateDkimKeyPair, stripPem } from './dkim-key.ts';

const PAIR = generateDkimKeyPair('munin-a1b2c3d4');
const OTHER = generateDkimKeyPair('munin-99999999');

function providerWith(resolver: (host: string) => Promise<string[][]>) {
  const provider = new DnsProbeSendingIdentityProvider();
  provider.setResolver(resolver);
  return provider;
}

function refreshArgs() {
  return { domain: 'acme.com', selector: PAIR.selector, publicKeyPem: PAIR.publicKeyPem };
}

describe('DnsProbeSendingIdentityProvider', () => {
  let queried: string[];

  beforeEach(() => {
    queried = [];
  });

  it('provisions without contacting anything', async () => {
    const provider = providerWith(() => Promise.reject(new Error('should not be called')));
    await expect(
      provider.provision({
        domain: 'acme.com',
        selector: PAIR.selector,
        privateKeyPem: PAIR.privateKeyPem,
        publicKeyPem: PAIR.publicKeyPem,
      }),
    ).resolves.toEqual({ providerRef: null });
  });

  it('verifies when the published key matches', async () => {
    const provider = providerWith((host) => {
      queried.push(host);
      return Promise.resolve([[dkimRecordValue(PAIR.publicKeyPem)]]);
    });
    await expect(provider.refresh(refreshArgs())).resolves.toEqual({ status: 'verified' });
    expect(queried).toEqual(['munin-a1b2c3d4._domainkey.acme.com']);
  });

  it('joins the chunks DNS splits long TXT values into', async () => {
    const value = dkimRecordValue(PAIR.publicKeyPem);
    const provider = providerWith(() => Promise.resolve([[value.slice(0, 120), value.slice(120)]]));
    await expect(provider.refresh(refreshArgs())).resolves.toEqual({ status: 'verified' });
  });

  it('finds the right record when the domain has several TXT records', async () => {
    const provider = providerWith(() =>
      Promise.resolve([['v=spf1 include:example.com ~all'], [dkimRecordValue(PAIR.publicKeyPem)]]),
    );
    await expect(provider.refresh(refreshArgs())).resolves.toEqual({ status: 'verified' });
  });

  it('stays pending when the record is absent', async () => {
    const provider = providerWith(() => {
      const err = new Error('queryTxt ENOTFOUND') as Error & { code?: string };
      err.code = 'ENOTFOUND';
      return Promise.reject(err);
    });
    const result = await provider.refresh(refreshArgs());
    expect(result.status).toBe('pending');
    expect(result.detail).toContain('no TXT record');
  });

  it('stays pending, and says why, when a different key is published', async () => {
    const provider = providerWith(() => Promise.resolve([[dkimRecordValue(OTHER.publicKeyPem)]]));
    const result = await provider.refresh(refreshArgs());
    expect(result.status).toBe('pending');
    expect(result.detail).toContain('does not match');
  });

  it('does not verify on a revoked record', async () => {
    const provider = providerWith(() => Promise.resolve([['v=DKIM1; k=rsa; p=']]));
    expect((await provider.refresh(refreshArgs())).status).toBe('pending');
  });

  it('treats a transient resolver failure as pending rather than failed', async () => {
    const provider = providerWith(() => {
      const err = new Error('queryTxt ESERVFAIL') as Error & { code?: string };
      err.code = 'ESERVFAIL';
      return Promise.reject(err);
    });
    const result = await provider.refresh(refreshArgs());
    expect(result.status).toBe('pending');
    expect(result.detail).toContain('lookup failed');
  });

  it('compares against the stripped PEM, not the raw PEM', async () => {
    const provider = providerWith(() =>
      Promise.resolve([[`v=DKIM1; k=rsa; p=${stripPem(PAIR.publicKeyPem)}`]]),
    );
    await expect(provider.refresh(refreshArgs())).resolves.toEqual({ status: 'verified' });
  });
});
