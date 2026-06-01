import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
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
