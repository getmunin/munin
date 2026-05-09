import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { OAuthAsAliasController } from './oauth-as-alias.controller.js';

describe('OAuthAsAliasController', () => {
  let originalUrl: string | undefined;

  beforeEach(() => {
    originalUrl = process.env.MUNIN_PUBLIC_URL;
    process.env.MUNIN_PUBLIC_URL = 'https://api.example.test';
  });

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.MUNIN_PUBLIC_URL;
    else process.env.MUNIN_PUBLIC_URL = originalUrl;
  });

  it('returns RFC 8414 authorization-server metadata pointing at /auth/oauth2/*', () => {
    const out = new OAuthAsAliasController().metadata();
    expect(out.issuer).toBe('https://api.example.test');
    expect(out.authorization_endpoint).toBe('https://api.example.test/auth/oauth2/authorize');
    expect(out.token_endpoint).toBe('https://api.example.test/auth/oauth2/token');
    expect(out.registration_endpoint).toBe('https://api.example.test/auth/oauth2/register');
    expect(out.jwks_uri).toBe('https://api.example.test/auth/jwks');
    expect(out.code_challenge_methods_supported).toContain('S256');
    expect(out.grant_types_supported).toContain('authorization_code');
    expect(out.scopes_supported).toContain('mcp:tools');
    expect(out.resource_indicators_supported).toBe(true);
  });
});
