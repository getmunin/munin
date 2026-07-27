import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { OAuthAsAliasController } from './oauth-as-alias.controller.ts';

describe('OAuthAsAliasController', () => {
  let originalUrl: string | undefined;
  let originalAuthUrl: string | undefined;

  beforeEach(() => {
    originalUrl = process.env.NEXT_PUBLIC_MCP_URL;
    originalAuthUrl = process.env.NEXT_PUBLIC_AUTH_URL;
    process.env.NEXT_PUBLIC_MCP_URL = 'https://api.example.test';
  });

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_MCP_URL;
    else process.env.NEXT_PUBLIC_MCP_URL = originalUrl;
    if (originalAuthUrl === undefined) delete process.env.NEXT_PUBLIC_AUTH_URL;
    else process.env.NEXT_PUBLIC_AUTH_URL = originalAuthUrl;
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

  it('advertises RFC 9207 iss support, which BetterAuth emits on the authorization response', () => {
    const out = new OAuthAsAliasController().metadata();
    expect(out.authorization_response_iss_parameter_supported).toBe(true);
  });

  it('derives the issuer from the origin so it matches the iss BetterAuth emits', () => {
    process.env.NEXT_PUBLIC_MCP_URL = 'https://api.example.test/mcp';
    delete process.env.NEXT_PUBLIC_AUTH_URL;
    const out = new OAuthAsAliasController().metadata();
    expect(out.issuer).toBe('https://api.example.test');
  });
});
