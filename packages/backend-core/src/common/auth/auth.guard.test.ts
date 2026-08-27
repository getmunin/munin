import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrgAccessDeniedError, type ResolvedCredential } from '@getmunin/core';
import { AuthGuard, type AuthenticatedRequest } from './auth.guard.ts';
import type { McpSurface } from '../../oauth/mcp-surface.ts';

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

function makeGuard(
  resolverStubs: {
    resolveSessionToken?: ReturnType<typeof vi.fn>;
    resolveBearerToken?: ReturnType<typeof vi.fn>;
    resolveApiKey?: ReturnType<typeof vi.fn>;
  },
  surfaces?: McpSurface[],
): AuthGuard {
  const guard = new AuthGuard({} as never, new Reflector(), [], surfaces);
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
    expect(resolveSessionToken).toHaveBeenCalledWith('raw', null);
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

describe('AuthGuard per-request org selection', () => {
  it('passes the x-munin-org header through to session resolution', async () => {
    const resolveSessionToken = vi.fn().mockResolvedValue({ actor: { type: 'user' } });
    const guard = makeGuard({ resolveSessionToken });
    const ctx = makeContext({
      headers: { cookie: SESSION_COOKIE, 'x-munin-org': 'org_two' },
      url: '/v1/kb/spaces',
      path: '/v1/kb/spaces',
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(resolveSessionToken).toHaveBeenCalledWith('raw', 'org_two');
  });

  it('treats a blank x-munin-org header as unset', async () => {
    const resolveSessionToken = vi.fn().mockResolvedValue({ actor: { type: 'user' } });
    const guard = makeGuard({ resolveSessionToken });
    const ctx = makeContext({
      headers: { cookie: SESSION_COOKIE, 'x-munin-org': '   ' },
      url: '/v1/kb/spaces',
      path: '/v1/kb/spaces',
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(resolveSessionToken).toHaveBeenCalledWith('raw', null);
  });

  it('answers a non-membership org with a coded 403, not a 401', async () => {
    const resolveSessionToken = vi.fn().mockRejectedValue(new OrgAccessDeniedError('org_other'));
    const guard = makeGuard({ resolveSessionToken });
    const ctx = makeContext({
      headers: { cookie: SESSION_COOKIE, 'x-munin-org': 'org_other' },
      url: '/v1/kb/spaces',
      path: '/v1/kb/spaces',
    });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      status: 403,
      response: { code: 'org_access_denied' },
    });
  });

  it('ignores x-munin-org when the caller authenticates with an api key', async () => {
    const resolveApiKey = vi.fn().mockResolvedValue({ actor: { type: 'admin_agent', orgId: 'org_key' } });
    const guard = makeGuard({ resolveApiKey });
    const ctx = makeContext({
      headers: { authorization: 'Bearer mn_admin_abc', 'x-munin-org': 'org_other' },
      url: '/v1/kb/spaces',
      path: '/v1/kb/spaces',
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(resolveApiKey).toHaveBeenCalledWith('mn_admin_abc');
  });

  it('echoes the org that actually served the request', async () => {
    const resolveSessionToken = vi
      .fn()
      .mockResolvedValue({ actor: { type: 'user', orgId: 'org_served' } });
    const guard = makeGuard({ resolveSessionToken });
    const req = {
      headers: { cookie: SESSION_COOKIE },
      url: '/v1/kb/spaces',
      path: '/v1/kb/spaces',
    };
    const res = { setHeader: vi.fn() };
    const ctx = {
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as unknown as Parameters<AuthGuard['canActivate']>[0];
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(res.setHeader).toHaveBeenCalledWith('x-munin-org', 'org_served');
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
    expect(resolveSessionToken).toHaveBeenCalledWith('raw', null);
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
    expect(resolveSessionToken).toHaveBeenCalledWith('devraw', null);
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

  it('accepts an audience that differs from the resource only by a trailing slash', async () => {
    const resolveBearerToken = vi.fn().mockResolvedValue(mcpCred('https://api.example.com/mcp/'));
    const guard = makeGuard({ resolveBearerToken });
    const ctx = makeContext({
      headers: { authorization: 'Bearer some-oauth-token' },
      url: '/mcp',
      path: '/mcp',
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});

describe('AuthGuard audience binding for registered MCP surfaces', () => {
  let originalMcp: string | undefined;
  let originalAuth: string | undefined;

  const surfaces: McpSurface[] = [
    { id: 'addon', path: '/mcp/addon', resourceName: 'Addon', scopes: ['addon:write'] },
  ];

  beforeEach(() => {
    originalMcp = process.env.NEXT_PUBLIC_MCP_URL;
    originalAuth = process.env.NEXT_PUBLIC_AUTH_URL;
    process.env.NEXT_PUBLIC_MCP_URL = 'https://api.example.com/mcp';
  });
  afterEach(() => {
    if (originalMcp === undefined) delete process.env.NEXT_PUBLIC_MCP_URL;
    else process.env.NEXT_PUBLIC_MCP_URL = originalMcp;
    if (originalAuth === undefined) delete process.env.NEXT_PUBLIC_AUTH_URL;
    else process.env.NEXT_PUBLIC_AUTH_URL = originalAuth;
  });

  function credWithAudience(audience: string): ResolvedCredential {
    return {
      actor: { type: 'user', scopes: ['mcp:admin'], audiences: ['admin'] } as never,
      audience,
    };
  }

  function contextFor(path: string) {
    return makeContext({
      headers: { authorization: 'Bearer some-oauth-token' },
      url: path,
      path,
    });
  }

  it('accepts the surface resource on the surface path', async () => {
    const resolveBearerToken = vi
      .fn()
      .mockResolvedValue(credWithAudience('https://api.example.com/mcp/addon'));
    const guard = makeGuard({ resolveBearerToken }, surfaces);
    await expect(guard.canActivate(contextFor('/mcp/addon'))).resolves.toBe(true);
  });

  it('still accepts the base MCP resource on the surface path', async () => {
    const resolveBearerToken = vi
      .fn()
      .mockResolvedValue(credWithAudience('https://api.example.com/mcp'));
    const guard = makeGuard({ resolveBearerToken }, surfaces);
    await expect(guard.canActivate(contextFor('/mcp/addon'))).resolves.toBe(true);
  });

  it('rejects a surface resource presented on the base MCP endpoint', async () => {
    const resolveBearerToken = vi
      .fn()
      .mockResolvedValue(credWithAudience('https://api.example.com/mcp/addon'));
    const guard = makeGuard({ resolveBearerToken }, surfaces);
    await expect(guard.canActivate(contextFor('/mcp'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects one surface resource presented to another surface', async () => {
    const resolveBearerToken = vi
      .fn()
      .mockResolvedValue(credWithAudience('https://api.example.com/mcp/addon'));
    const guard = makeGuard({ resolveBearerToken }, [
      ...surfaces,
      { id: 'other', path: '/mcp/other', resourceName: 'Other', scopes: [] },
    ]);
    await expect(guard.canActivate(contextFor('/mcp/other'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('points the WWW-Authenticate challenge at the surface metadata document', async () => {
    process.env.NEXT_PUBLIC_AUTH_URL = 'https://auth.example.com';
    const guard = makeGuard({ resolveBearerToken: vi.fn().mockResolvedValue(null) }, surfaces);
    const res = { setHeader: vi.fn() };
    const ctx = {
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { authorization: 'Bearer nope' },
          url: '/mcp/addon',
          path: '/mcp/addon',
        }),
        getResponse: () => res,
      }),
    } as unknown as Parameters<AuthGuard['canActivate']>[0];

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(res.setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      'Bearer resource_metadata="https://auth.example.com/.well-known/oauth-protected-resource/mcp/addon"',
    );
  });
});

describe('AuthGuard org-scoped MCP endpoints', () => {
  const ORG_A = 'org_aaaaaaaaaaaaaaaaaaaaaa';
  const ORG_B = 'org_bbbbbbbbbbbbbbbbbbbbbb';
  let originalMcp: string | undefined;
  let originalAuth: string | undefined;

  beforeEach(() => {
    originalMcp = process.env.NEXT_PUBLIC_MCP_URL;
    originalAuth = process.env.NEXT_PUBLIC_AUTH_URL;
    process.env.NEXT_PUBLIC_MCP_URL = 'https://mcp.example.com';
  });

  afterEach(() => {
    if (originalMcp === undefined) delete process.env.NEXT_PUBLIC_MCP_URL;
    else process.env.NEXT_PUBLIC_MCP_URL = originalMcp;
    if (originalAuth === undefined) delete process.env.NEXT_PUBLIC_AUTH_URL;
    else process.env.NEXT_PUBLIC_AUTH_URL = originalAuth;
  });

  function credFor(orgId: string, audience?: string): ResolvedCredential {
    return {
      actor: { type: 'user', orgId, scopes: ['mcp:admin'], audiences: ['admin'] } as never,
      ...(audience ? { audience } : {}),
    };
  }

  function contextFor(path: string) {
    return makeContext({
      headers: { authorization: 'Bearer some-token' },
      url: path,
      path,
    });
  }

  const MEDIA_SURFACE: McpSurface = {
    id: 'media',
    path: '/mcp/media',
    resourceName: 'Munin Media',
    scopes: ['mcp:admin', 'media:write'],
  };

  it('enforces the org on a surface path exactly as on the shared one', async () => {
    const resolveBearerToken = vi.fn().mockResolvedValue(credFor(ORG_B));
    const guard = makeGuard({ resolveBearerToken }, [MEDIA_SURFACE]);
    await expect(guard.canActivate(contextFor(`/mcp/media/o/${ORG_A}`))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('accepts a credential whose org matches an org-scoped surface path', async () => {
    const resolveBearerToken = vi.fn().mockResolvedValue(credFor(ORG_A));
    const guard = makeGuard({ resolveBearerToken }, [MEDIA_SURFACE]);
    await expect(guard.canActivate(contextFor(`/mcp/media/o/${ORG_A}`))).resolves.toBe(true);
  });

  it('accepts the surface resource as an audience on its org-scoped path', async () => {
    const resolveBearerToken = vi
      .fn()
      .mockResolvedValue(credFor(ORG_A, 'https://mcp.example.com/mcp/media'));
    const guard = makeGuard({ resolveBearerToken }, [MEDIA_SURFACE]);
    await expect(guard.canActivate(contextFor(`/mcp/media/o/${ORG_A}`))).resolves.toBe(true);
  });

  it('accepts the org-scoped surface resource as an audience on its own path', async () => {
    const resolveBearerToken = vi
      .fn()
      .mockResolvedValue(credFor(ORG_A, `https://mcp.example.com/mcp/media/o/${ORG_A}`));
    const guard = makeGuard({ resolveBearerToken }, [MEDIA_SURFACE]);
    await expect(guard.canActivate(contextFor(`/mcp/media/o/${ORG_A}`))).resolves.toBe(true);
  });

  it('refuses an org-scoped surface audience on another org of the same surface', async () => {
    const resolveBearerToken = vi
      .fn()
      .mockResolvedValue(credFor(ORG_A, `https://mcp.example.com/mcp/media/o/${ORG_B}`));
    const guard = makeGuard({ resolveBearerToken }, [MEDIA_SURFACE]);
    await expect(guard.canActivate(contextFor(`/mcp/media/o/${ORG_A}`))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('challenges with the org-scoped surface document, not the surface root', async () => {
    process.env.NEXT_PUBLIC_AUTH_URL = 'https://auth.example.com';
    const resolveBearerToken = vi.fn().mockResolvedValue(credFor(ORG_B));
    const guard = makeGuard({ resolveBearerToken }, [MEDIA_SURFACE]);
    const res = { setHeader: vi.fn() };
    const ctx = {
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { authorization: 'Bearer some-token' },
          url: `/mcp/media/o/${ORG_A}`,
          path: `/mcp/media/o/${ORG_A}`,
        }),
        getResponse: () => res,
      }),
    } as unknown as Parameters<AuthGuard['canActivate']>[0];

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(res.setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      `Bearer resource_metadata="https://auth.example.com/.well-known/oauth-protected-resource/mcp/media/o/${ORG_A}"`,
    );
  });

  it('404s a malformed org selector on a surface path', async () => {
    const guard = makeGuard({}, [MEDIA_SURFACE]);
    await expect(guard.canActivate(contextFor('/mcp/media/o/not-an-org'))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('accepts an api key whose org matches the path', async () => {
    const resolveApiKey = vi.fn().mockResolvedValue(credFor(ORG_A));
    const guard = makeGuard({ resolveApiKey });
    const ctx = makeContext({
      headers: { authorization: 'Bearer mn_admin_abc123' },
      url: `/mcp/o/${ORG_A}`,
      path: `/mcp/o/${ORG_A}`,
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('rejects a credential addressed at another org', async () => {
    const resolveBearerToken = vi.fn().mockResolvedValue(credFor(ORG_B));
    const guard = makeGuard({ resolveBearerToken });
    await expect(guard.canActivate(contextFor(`/mcp/o/${ORG_A}`))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('leaves the shared endpoint open to any org', async () => {
    const resolveBearerToken = vi.fn().mockResolvedValue(credFor(ORG_B));
    const guard = makeGuard({ resolveBearerToken });
    await expect(guard.canActivate(contextFor('/mcp'))).resolves.toBe(true);
  });

  it('accepts the org-scoped resource as an audience on its own path', async () => {
    const resolveBearerToken = vi
      .fn()
      .mockResolvedValue(credFor(ORG_A, `https://mcp.example.com/mcp/o/${ORG_A}`));
    const guard = makeGuard({ resolveBearerToken });
    await expect(guard.canActivate(contextFor(`/mcp/o/${ORG_A}`))).resolves.toBe(true);
  });

  it('rejects one org-scoped resource presented to another org path', async () => {
    const resolveBearerToken = vi
      .fn()
      .mockResolvedValue(credFor(ORG_A, `https://mcp.example.com/mcp/o/${ORG_B}`));
    const guard = makeGuard({ resolveBearerToken });
    await expect(guard.canActivate(contextFor(`/mcp/o/${ORG_A}`))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('still accepts the base resource on an org-scoped path', async () => {
    const resolveBearerToken = vi
      .fn()
      .mockResolvedValue(credFor(ORG_A, 'https://mcp.example.com'));
    const guard = makeGuard({ resolveBearerToken });
    await expect(guard.canActivate(contextFor(`/mcp/o/${ORG_A}`))).resolves.toBe(true);
  });

  it('challenges with the org-scoped metadata document so the client re-authorizes into that org', async () => {
    process.env.NEXT_PUBLIC_AUTH_URL = 'https://auth.example.com';
    const resolveBearerToken = vi.fn().mockResolvedValue(credFor(ORG_B));
    const guard = makeGuard({ resolveBearerToken });
    const res = { setHeader: vi.fn() };
    const ctx = {
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { authorization: 'Bearer some-token' },
          url: `/mcp/o/${ORG_A}`,
          path: `/mcp/o/${ORG_A}`,
        }),
        getResponse: () => res,
      }),
    } as unknown as Parameters<AuthGuard['canActivate']>[0];

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(res.setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      `Bearer resource_metadata="https://auth.example.com/.well-known/oauth-protected-resource/mcp/o/${ORG_A}"`,
    );
  });
});

describe('AuthGuard malformed org selectors', () => {
  const ORG_A = 'org_aaaaaaaaaaaaaaaaaaaaaa';
  let originalMcp: string | undefined;

  beforeEach(() => {
    originalMcp = process.env.NEXT_PUBLIC_MCP_URL;
    process.env.NEXT_PUBLIC_MCP_URL = 'https://mcp.example.com';
  });

  afterEach(() => {
    if (originalMcp === undefined) delete process.env.NEXT_PUBLIC_MCP_URL;
    else process.env.NEXT_PUBLIC_MCP_URL = originalMcp;
  });

  function guardFor(orgId: string): AuthGuard {
    return makeGuard({
      resolveApiKey: vi.fn().mockResolvedValue({
        actor: { type: 'user', orgId, scopes: ['*'], audiences: ['admin'] } as never,
      }),
    });
  }

  function contextFor(path: string) {
    return makeContext({
      headers: { authorization: 'Bearer mn_admin_abc123' },
      url: path,
      path,
    });
  }

  it.each([
    ['percent-encoded first character', '/mcp/o/%6frg_aaaaaaaaaaaaaaaaaaaaaa'],
    ['uppercased org id', '/mcp/o/ORG_AAAAAAAAAAAAAAAAAAAAAA'],
    ['null byte suffix', '/mcp/o/org_aaaaaaaaaaaaaaaaaaaaaa%00'],
    ['no org id at all', '/mcp/o/'],
    ['a sub-path below the org', '/mcp/o/org_aaaaaaaaaaaaaaaaaaaaaa/media'],
  ])('rejects %s rather than serving the credential its own org', async (_label, path) => {
    const guard = guardFor(ORG_A);
    await expect(guard.canActivate(contextFor(path))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('still serves the exact org-scoped path', async () => {
    const guard = guardFor(ORG_A);
    await expect(guard.canActivate(contextFor(`/mcp/o/${ORG_A}`))).resolves.toBe(true);
  });

  it('leaves the shared endpoint and other MCP paths alone', async () => {
    const guard = guardFor(ORG_A);
    await expect(guard.canActivate(contextFor('/mcp'))).resolves.toBe(true);
    await expect(guard.canActivate(contextFor('/mcp/media'))).resolves.toBe(true);
  });
});
