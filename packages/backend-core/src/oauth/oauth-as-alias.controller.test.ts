import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { OAuthAsAliasController } from './oauth-as-alias.controller.js';

describe('OAuthAsAliasController', () => {
  const originalFetch = global.fetch;
  let originalUrl: string | undefined;

  beforeEach(() => {
    originalUrl = process.env.MUNIN_PUBLIC_URL;
    process.env.MUNIN_PUBLIC_URL = 'https://api.example.test';
  });

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.MUNIN_PUBLIC_URL;
    else process.env.MUNIN_PUBLIC_URL = originalUrl;
    global.fetch = originalFetch;
  });

  it('proxies the upstream openid-configuration response', async () => {
    const fakeMeta = {
      issuer: 'https://api.example.test',
      authorization_endpoint: 'https://api.example.test/auth/oauth2/authorize',
      token_endpoint: 'https://api.example.test/auth/oauth2/token',
    };
    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(fakeMeta), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const out = await new OAuthAsAliasController().metadata();
    expect(out).toEqual(fakeMeta);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.test/auth/.well-known/openid-configuration',
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    );
  });

  it('throws 502 when upstream is unreachable', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(new Response('boom', { status: 500 })),
    );
    await expect(new OAuthAsAliasController().metadata()).rejects.toMatchObject({
      status: 502,
    });
  });
});
