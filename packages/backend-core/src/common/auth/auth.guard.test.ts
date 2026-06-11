import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedCredential } from '@getmunin/core';
import { AuthGuard, type AuthenticatedRequest } from './auth.guard.ts';

function makeContext(req: AuthenticatedRequest & { url?: string; path?: string }) {
  const res = { setHeader: vi.fn() };
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as Parameters<AuthGuard['canActivate']>[0];
}

function makeGuard(resolverStubs: {
  resolveSessionToken?: ReturnType<typeof vi.fn>;
  resolveBearerToken?: ReturnType<typeof vi.fn>;
  resolveApiKey?: ReturnType<typeof vi.fn>;
}): AuthGuard {
  const guard = new AuthGuard({} as never, new Reflector());
  Object.assign((guard as unknown as { resolver: Record<string, unknown> }).resolver, {
    resolveSessionToken: resolverStubs.resolveSessionToken ?? vi.fn(),
    resolveBearerToken: resolverStubs.resolveBearerToken ?? vi.fn(),
    resolveApiKey: resolverStubs.resolveApiKey ?? vi.fn(),
  });
  return guard;
}

const SESSION_COOKIE = 'better-auth.session_token=raw.signature';

describe('AuthGuard cookie fallback', () => {
  it('accepts session cookie on a non-MCP path', async () => {
    const resolveSessionToken = vi.fn().mockResolvedValue({ actor: { type: 'user' } });
    const guard = makeGuard({ resolveSessionToken });
    const ctx = makeContext({
      headers: { cookie: SESSION_COOKIE },
      url: '/v1/kb/spaces',
      path: '/v1/kb/spaces',
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(resolveSessionToken).toHaveBeenCalledWith('raw');
  });

  it('rejects session cookie on /mcp — bearer required', async () => {
    const resolveSessionToken = vi.fn();
    const guard = makeGuard({ resolveSessionToken });
    const ctx = makeContext({
      headers: { cookie: SESSION_COOKIE },
      url: '/mcp',
      path: '/mcp',
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(resolveSessionToken).not.toHaveBeenCalled();
  });

  it('rejects session cookie on /mcp/* subpaths too', async () => {
    const resolveSessionToken = vi.fn();
    const guard = makeGuard({ resolveSessionToken });
    const ctx = makeContext({
      headers: { cookie: SESSION_COOKIE },
      url: '/mcp/session/abc',
      path: '/mcp/session/abc',
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(resolveSessionToken).not.toHaveBeenCalled();
  });
});

describe('AuthGuard cookie prefix (MUNIN_AUTH_COOKIE_PREFIX)', () => {
  let originalPrefix: string | undefined;

  beforeEach(() => {
    originalPrefix = process.env.MUNIN_AUTH_COOKIE_PREFIX;
    process.env.MUNIN_AUTH_COOKIE_PREFIX = 'munin-dev';
  });
  afterEach(() => {
    if (originalPrefix === undefined) delete process.env.MUNIN_AUTH_COOKIE_PREFIX;
    else process.env.MUNIN_AUTH_COOKIE_PREFIX = originalPrefix;
  });

  it('accepts the prefixed session cookie', async () => {
    const resolveSessionToken = vi.fn().mockResolvedValue({ actor: { type: 'user' } });
    const guard = makeGuard({ resolveSessionToken });
    const ctx = makeContext({
      headers: { cookie: '__Secure-munin-dev.session_token=raw.signature' },
      url: '/v1/kb/spaces',
      path: '/v1/kb/spaces',
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(resolveSessionToken).toHaveBeenCalledWith('raw');
  });

  it('ignores a default-named cookie from another environment', async () => {
    const resolveSessionToken = vi.fn().mockResolvedValue({ actor: { type: 'user' } });
    const guard = makeGuard({ resolveSessionToken });
    const ctx = makeContext({
      headers: {
        cookie: `${SESSION_COOKIE}; __Secure-munin-dev.session_token=devraw.signature`,
      },
      url: '/v1/kb/spaces',
      path: '/v1/kb/spaces',
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(resolveSessionToken).toHaveBeenCalledWith('devraw');
  });
});

describe('AuthGuard audience binding', () => {
  let originalMcp: string | undefined;

  beforeEach(() => {
    originalMcp = process.env.NEXT_PUBLIC_MCP_URL;
    process.env.NEXT_PUBLIC_MCP_URL = 'https://api.example.com/mcp';
  });
  afterEach(() => {
    if (originalMcp === undefined) delete process.env.NEXT_PUBLIC_MCP_URL;
    else process.env.NEXT_PUBLIC_MCP_URL = originalMcp;
  });

  function mcpCred(audience = 'https://api.example.com/mcp'): ResolvedCredential {
    return {
      actor: {
        type: 'user',
        scopes: ['mcp:admin'],
        audiences: ['admin'],
      } as never,
      audience,
    };
  }

  it('rejects an MCP-audience bearer when presented to /v1/*', async () => {
    const resolveBearerToken = vi.fn().mockResolvedValue(mcpCred());
    const guard = makeGuard({ resolveBearerToken });
    const ctx = makeContext({
      headers: { authorization: 'Bearer some-oauth-token' },
      url: '/v1/conversations',
      path: '/v1/conversations',
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts an MCP-audience bearer on /mcp when audience matches exactly', async () => {
    const resolveBearerToken = vi.fn().mockResolvedValue(mcpCred());
    const guard = makeGuard({ resolveBearerToken });
    const ctx = makeContext({
      headers: { authorization: 'Bearer some-oauth-token' },
      url: '/mcp',
      path: '/mcp',
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('rejects an MCP-audience bearer on /mcp when audience does not match', async () => {
    const resolveBearerToken = vi
      .fn()
      .mockResolvedValue(mcpCred('https://wrong.example.com/mcp'));
    const guard = makeGuard({ resolveBearerToken });
    const ctx = makeContext({
      headers: { authorization: 'Bearer some-oauth-token' },
      url: '/mcp',
      path: '/mcp',
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
