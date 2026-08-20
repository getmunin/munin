import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Request as ExpressRequestLike } from 'express';
import {
  assertProductionAuthSecret,
  narrowAuthRequestBody,
  narrowOrgMarkerQuery,
  readCodeChallenge,
  readRequestedOrgScope,
  readRequestedResource,
  requireAuthSecret,
  resolveMcpOrgScope,
} from './auth-controller-factory.ts';
import {
  buildOrgScopeAssociationKeys,
  registerOrgScopeStore,
  type OrgScopeAssociationKeys,
  type OrgScopeStore,
} from './auth/org-scope-store.ts';

describe('assertProductionAuthSecret', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSecret = process.env.MUNIN_AUTH_SECRET;

  beforeEach(() => {
    delete process.env.NODE_ENV;
    delete process.env.MUNIN_AUTH_SECRET;
  });
  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalSecret === undefined) delete process.env.MUNIN_AUTH_SECRET;
    else process.env.MUNIN_AUTH_SECRET = originalSecret;
  });

  it('is a no-op outside production', () => {
    process.env.NODE_ENV = 'development';
    expect(() => assertProductionAuthSecret('short')).not.toThrow();
    expect(() => assertProductionAuthSecret('replace-me-with-strong-random-secret')).not.toThrow();
  });

  it('rejects secrets shorter than 32 characters in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertProductionAuthSecret('a'.repeat(31))).toThrow(/at least 32 characters/);
  });

  it('accepts a 32+ character non-placeholder secret in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertProductionAuthSecret('Z4kP+yV1c3xQ9bN2mL8wF6rE7tH0jU5o')).not.toThrow();
  });

  it('rejects known placeholder shapes even at full length', () => {
    process.env.NODE_ENV = 'production';
    const padded = (s: string) => s + 'x'.repeat(Math.max(0, 33 - s.length));
    expect(() =>
      assertProductionAuthSecret(padded('replace-me-with-strong-random-secret')),
    ).toThrow(/placeholder\/dev value/);
    expect(() => assertProductionAuthSecret(padded('dev-secret-do-not-use-in-prod'))).toThrow(
      /placeholder\/dev value/,
    );
    expect(() => assertProductionAuthSecret(padded('changeme-please-rotate-rotate'))).toThrow(
      /placeholder\/dev value/,
    );
    expect(() => assertProductionAuthSecret(padded('test-secret-test-test-test-test'))).toThrow(
      /placeholder\/dev value/,
    );
  });

  it('rejects trivially low-entropy secrets in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertProductionAuthSecret('x'.repeat(64))).toThrow(/placeholder\/dev value/);
    expect(() => assertProductionAuthSecret('a'.repeat(64))).toThrow(/placeholder\/dev value/);
    expect(() => assertProductionAuthSecret('0'.repeat(64))).toThrow(/placeholder\/dev value/);
  });

  it('requireAuthSecret propagates production validation', () => {
    process.env.NODE_ENV = 'production';
    process.env.MUNIN_AUTH_SECRET = 'replace-me-with-strong-random-secret';
    expect(() => requireAuthSecret()).toThrow(/placeholder\/dev value/);
  });
});

describe('org-scoped resource on auth requests', () => {
  const ORG_A = 'org_aaaaaaaaaaaaaaaaaaaaaa';
  const ORG_B = 'org_bbbbbbbbbbbbbbbbbbbbbb';
  const originalMcp = process.env.NEXT_PUBLIC_MCP_URL;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_MCP_URL = 'https://mcp.example.test';
  });
  afterEach(() => {
    if (originalMcp === undefined) delete process.env.NEXT_PUBLIC_MCP_URL;
    else process.env.NEXT_PUBLIC_MCP_URL = originalMcp;
  });

  function requestWith(parts: {
    url?: string;
    query?: Record<string, unknown>;
    body?: unknown;
    contentType?: string;
    rawBody?: string;
  }) {
    return {
      originalUrl: parts.url ?? '/auth/oauth2/authorize',
      url: parts.url ?? '/auth/oauth2/authorize',
      query: parts.query ?? {},
      body: parts.body,
      headers: parts.contentType ? { 'content-type': parts.contentType } : {},
      ...(parts.rawBody === undefined ? {} : { rawBody: Buffer.from(parts.rawBody, 'utf8') }),
    } as unknown as Parameters<typeof readRequestedResource>[0];
  }

  it('reads the resource from the authorize query', () => {
    const resource = `https://mcp.example.test/mcp/o/${ORG_A}`;
    expect(readRequestedResource(requestWith({ query: { resource } }))).toBe(resource);
  });

  it('reads the resource from a token request body', () => {
    const resource = `https://mcp.example.test/mcp/o/${ORG_A}`;
    expect(readRequestedResource(requestWith({ body: { resource } }))).toBe(resource);
  });

  it('recovers the resource from the signed query the consent page replays', () => {
    const resource = `https://mcp.example.test/mcp/o/${ORG_A}`;
    const oauthQuery = new URLSearchParams({ client_id: 'abc', resource }).toString();
    expect(
      readRequestedResource(requestWith({ body: { accept: true, oauth_query: oauthQuery } })),
    ).toBe(resource);
  });

  it('returns null when no resource is requested', () => {
    expect(
      readRequestedResource(requestWith({ body: { grant_type: 'refresh_token' } })),
    ).toBeNull();
  });

  it('reads the org from the marker scope when the client sends no resource', () => {
    expect(
      readRequestedOrgScope(requestWith({ query: { scope: `offline_access mcp:org:${ORG_A}` } })),
    ).toEqual({ orgId: ORG_A, basePath: '/mcp' });
    expect(
      readRequestedOrgScope(requestWith({ body: { scope: `mcp:org:${ORG_A} kb:read` } })),
    ).toEqual({ orgId: ORG_A, basePath: '/mcp' });
    expect(
      readRequestedOrgScope(requestWith({ query: { scope: 'offline_access kb:read' } })),
    ).toBeNull();
  });

  it('prefers the resource over the marker scope when a client sends both', () => {
    expect(
      readRequestedOrgScope(
        requestWith({
          query: {
            resource: `https://mcp.example.test/mcp/o/${ORG_A}`,
            scope: `mcp:org:${ORG_B}`,
          },
        }),
      ),
    ).toEqual({ orgId: ORG_A, basePath: '/mcp' });
  });

  it('ignores a marker in the replayed signed query, which the provider never signed one into', () => {
    const oauthQuery = new URLSearchParams({ scope: `mcp:org:${ORG_A}` }).toString();
    expect(
      readRequestedOrgScope(requestWith({ body: { accept: true, oauth_query: oauthQuery } })),
    ).toBeNull();

    expect(
      readRequestedOrgScope(
        requestWith({ query: { resource: `https://mcp.example.test/mcp/media/o/${ORG_A}` } }),
      ),
    ).toEqual({ orgId: ORG_A, basePath: '/mcp/media' });
  });

  it('strips the marker scope out of the authorize query the provider will validate', () => {
    const query = narrowOrgMarkerQuery(
      requestWith({
        url: `/auth/oauth2/authorize?client_id=abc&scope=offline_access+mcp%3Aorg%3A${ORG_A}+kb%3Aread`,
        query: { client_id: 'abc', scope: `offline_access mcp:org:${ORG_A} kb:read` },
      }),
    );
    expect(query).not.toBeNull();
    const params = new URLSearchParams(query!);
    expect(params.get('scope')).toBe('offline_access kb:read');
    expect(params.get('client_id')).toBe('abc');
  });

  it('drops the scope parameter entirely when the marker was all of it', () => {
    const query = narrowOrgMarkerQuery(
      requestWith({
        url: `/auth/oauth2/register?scope=mcp%3Aorg%3A${ORG_A}`,
        query: { scope: `mcp:org:${ORG_A}` },
      }),
    );
    expect(new URLSearchParams(query!).has('scope')).toBe(false);
  });

  it('leaves a query without a marker untouched', () => {
    expect(
      narrowOrgMarkerQuery(
        requestWith({
          url: '/auth/oauth2/authorize?scope=kb%3Aread',
          query: { scope: 'kb:read' },
        }),
      ),
    ).toBeNull();
  });

  it('strips the marker scope out of a request body', () => {
    const override = narrowAuthRequestBody(
      requestWith({
        body: { client_name: 'app', scope: `offline_access mcp:org:${ORG_A}` },
        contentType: 'application/json',
      }),
    );
    expect(JSON.parse(override!.body)).toEqual({ client_name: 'app', scope: 'offline_access' });
  });

  it('narrows an org-scoped resource to the base resource on urlencoded token bodies', () => {
    const resource = `https://mcp.example.test/mcp/o/${ORG_A}`;
    const rawBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code: 'xyz',
      code_verifier: 'a-b_c~d',
      resource,
    }).toString();
    const override = narrowAuthRequestBody(
      requestWith({
        body: { grant_type: 'authorization_code', code: 'xyz', code_verifier: 'a-b_c~d', resource },
        contentType: 'application/x-www-form-urlencoded',
        rawBody,
      }),
    );
    expect(override).not.toBeNull();
    expect(override!.contentType).toBe('application/x-www-form-urlencoded');
    const params = new URLSearchParams(override!.body);
    expect(params.get('resource')).toBe('https://mcp.example.test');
    expect(params.get('code')).toBe('xyz');
    expect(params.get('code_verifier')).toBe('a-b_c~d');
    expect(params.get('grant_type')).toBe('authorization_code');
  });

  it('falls back to a JSON body when no raw urlencoded body was captured', () => {
    const override = narrowAuthRequestBody(
      requestWith({
        body: { code: 'xyz', resource: `https://mcp.example.test/mcp/o/${ORG_A}` },
        contentType: 'application/x-www-form-urlencoded',
      }),
    );
    expect(override!.contentType).toBe('application/json');
    expect(JSON.parse(override!.body)).toEqual({
      code: 'xyz',
      resource: 'https://mcp.example.test',
    });
  });

  it('narrows an org-scoped resource on JSON token bodies', () => {
    const override = narrowAuthRequestBody(
      requestWith({
        body: { resource: `https://mcp.example.test/mcp/o/${ORG_A}`, code: 'xyz' },
        contentType: 'application/json',
      }),
    );
    expect(JSON.parse(override!.body)).toEqual({
      resource: 'https://mcp.example.test',
      code: 'xyz',
    });
  });

  it('narrows an org-scoped surface resource to that surface, not to the base resource', () => {
    const override = narrowAuthRequestBody(
      requestWith({
        body: { code: 'xyz', resource: `https://mcp.example.test/mcp/media/o/${ORG_A}` },
        contentType: 'application/json',
      }),
    );
    expect(JSON.parse(override!.body)).toEqual({
      code: 'xyz',
      resource: 'https://mcp.example.test/mcp/media',
    });
  });

  it('leaves the base resource and foreign-origin resources untouched', () => {
    expect(
      narrowAuthRequestBody(requestWith({ body: { resource: 'https://mcp.example.test' } })),
    ).toBeNull();
    expect(
      narrowAuthRequestBody(
        requestWith({ body: { resource: `https://evil.example.test/mcp/o/${ORG_A}` } }),
      ),
    ).toBeNull();
  });
});

describe('carrying the org across the consent round-trip', () => {
  const ORG_A = 'org_aaaaaaaaaaaaaaaaaaaaaa';
  const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
  const COOKIE = 'better-auth.session_token=victim-session-token.signature';
  const OTHER_COOKIE = 'better-auth.session_token=attacker-session-token.signature';
  const originalMcp = process.env.NEXT_PUBLIC_MCP_URL;
  let recalls: OrgScopeAssociationKeys[];
  let remembered: Array<{ keys: OrgScopeAssociationKeys; orgId: string; basePath: string }>;

  const SECRET = 'test-secret-for-the-association-key-000000';
  const keysOf = (cookie: string | undefined, challenge: string | undefined) =>
    buildOrgScopeAssociationKeys(SECRET, cookie, challenge);

  function fakeStore(
    recallValue: string | null = null,
    failing = false,
    recallBasePath = '/mcp',
  ): OrgScopeStore {
    return {
      keysFor: (cookieHeader, codeChallenge) =>
        buildOrgScopeAssociationKeys(SECRET, cookieHeader, codeChallenge),
      remember: (keys, orgId, basePath) => {
        if (failing) return Promise.reject(new Error('store down'));
        remembered.push({ keys, orgId, basePath: basePath ?? '/mcp' });
        return Promise.resolve();
      },
      recall: (keys) => {
        if (failing) return Promise.reject(new Error('store down'));
        recalls.push(keys);
        return Promise.resolve(
          recallValue ? { orgId: recallValue, basePath: recallBasePath } : null,
        );
      },
    };
  }

  function request(parts: {
    url?: string;
    query?: Record<string, unknown>;
    body?: unknown;
    cookie?: string;
  }): ExpressRequestLike {
    return {
      originalUrl: parts.url ?? '/auth/oauth2/authorize',
      url: parts.url ?? '/auth/oauth2/authorize',
      query: parts.query ?? {},
      body: parts.body,
      headers: parts.cookie === undefined ? {} : { cookie: parts.cookie },
    } as unknown as ExpressRequestLike;
  }

  beforeEach(() => {
    process.env.NEXT_PUBLIC_MCP_URL = 'https://mcp.example.test';
    recalls = [];
    remembered = [];
  });
  afterEach(() => {
    registerOrgScopeStore(null);
    if (originalMcp === undefined) delete process.env.NEXT_PUBLIC_MCP_URL;
    else process.env.NEXT_PUBLIC_MCP_URL = originalMcp;
  });

  it('reads the code challenge from the authorize query, a body, and the replayed signed query', () => {
    expect(readCodeChallenge(request({ query: { code_challenge: CHALLENGE } }))).toBe(CHALLENGE);
    expect(readCodeChallenge(request({ body: { code_challenge: CHALLENGE } }))).toBe(CHALLENGE);
    const oauthQuery = new URLSearchParams({
      client_id: 'abc',
      code_challenge: CHALLENGE,
    }).toString();
    expect(readCodeChallenge(request({ body: { accept: true, oauth_query: oauthQuery } }))).toBe(
      CHALLENGE,
    );
    expect(readCodeChallenge(request({ body: { grant_type: 'refresh_token' } }))).toBeNull();
  });

  it('derives a session key that differs per session for the same challenge', () => {
    const victim = keysOf(COOKIE, CHALLENGE).session;
    const attacker = keysOf(OTHER_COOKIE, CHALLENGE).session;
    const otherSecret = buildOrgScopeAssociationKeys(
      'a-different-server-secret',
      COOKIE,
      CHALLENGE,
    ).session;
    expect(otherSecret).not.toBe(victim);
    expect(victim).toBeTruthy();
    expect(attacker).toBeTruthy();
    expect(victim).not.toBe(attacker);
    expect(victim).toBe(keysOf(COOKIE, CHALLENGE).session);
    expect(victim).not.toContain('victim-session-token');
  });

  it('derives a challenge key with no session, and no key at all without a challenge', () => {
    const anonymous = keysOf(undefined, CHALLENGE);
    expect(anonymous.session).toBeNull();
    expect(anonymous.challenge).toBeTruthy();
    expect(anonymous.challenge).toBe(keysOf(COOKIE, CHALLENGE).challenge);
    expect(anonymous.challenge).not.toContain(CHALLENGE);
    expect(keysOf(COOKIE, undefined)).toEqual({ session: null, challenge: null });
    expect(buildOrgScopeAssociationKeys('', COOKIE, CHALLENGE)).toEqual({
      session: null,
      challenge: null,
    });
  });

  it('writes the association on the authorize leg, which is the only one carrying the org', async () => {
    registerOrgScopeStore(fakeStore());
    const resource = `https://mcp.example.test/mcp/o/${ORG_A}`;
    const scope = await resolveMcpOrgScope(
      request({ query: { resource, code_challenge: CHALLENGE }, cookie: COOKIE }),
    );
    expect(scope.resource).toBe(resource);
    expect(remembered).toEqual([
      { keys: keysOf(COOKIE, CHALLENGE), orgId: ORG_A, basePath: '/mcp' },
    ]);
  });

  it('writes the association for an authorize that only carries the marker scope', async () => {
    registerOrgScopeStore(fakeStore());
    const scope = await resolveMcpOrgScope(
      request({
        query: { scope: `offline_access mcp:org:${ORG_A}`, code_challenge: CHALLENGE },
        cookie: COOKIE,
      }),
    );
    expect(scope.resource).toBe(`https://mcp.example.test/mcp/o/${ORG_A}`);
    expect(remembered).toEqual([
      { keys: keysOf(COOKIE, CHALLENGE), orgId: ORG_A, basePath: '/mcp' },
    ]);
  });

  it('writes the association before the caller has signed in', async () => {
    registerOrgScopeStore(fakeStore());
    await resolveMcpOrgScope(
      request({ query: { scope: `mcp:org:${ORG_A}`, code_challenge: CHALLENGE } }),
    );
    expect(remembered).toEqual([
      { keys: keysOf(undefined, CHALLENGE), orgId: ORG_A, basePath: '/mcp' },
    ]);
  });

  it('remembers which resource the org was asked for, so the token narrows to it', async () => {
    registerOrgScopeStore(fakeStore());
    const resource = `https://mcp.example.test/mcp/media/o/${ORG_A}`;
    const scope = await resolveMcpOrgScope(
      request({ query: { resource, code_challenge: CHALLENGE }, cookie: COOKIE }),
    );
    expect(scope.resource).toBe(resource);
    expect(remembered).toEqual([
      { keys: keysOf(COOKIE, CHALLENGE), orgId: ORG_A, basePath: '/mcp/media' },
    ]);
  });

  it('recalls a surface association back to the surface resource on the consent post', async () => {
    registerOrgScopeStore(fakeStore(ORG_A, false, '/mcp/media'));
    const oauthQuery = new URLSearchParams({ code_challenge: CHALLENGE }).toString();
    const scope = await resolveMcpOrgScope(
      request({ url: '/auth/oauth2/consent', body: { oauth_query: oauthQuery }, cookie: COOKIE }),
    );
    expect(scope.resource).toBe(`https://mcp.example.test/mcp/media/o/${ORG_A}`);
  });

  it('recovers the org on the consent post, where better-auth has dropped the resource', async () => {
    registerOrgScopeStore(fakeStore(ORG_A));
    const oauthQuery = new URLSearchParams({
      client_id: 'abc',
      code_challenge: CHALLENGE,
    }).toString();
    const scope = await resolveMcpOrgScope(
      request({
        url: '/auth/oauth2/consent',
        body: { accept: true, oauth_query: oauthQuery },
        cookie: COOKIE,
      }),
    );
    expect(scope.resource).toBe(`https://mcp.example.test/mcp/o/${ORG_A}`);
    expect(recalls).toEqual([keysOf(COOKIE, CHALLENGE)]);
  });

  it("looks under this session's key first, so one session cannot claim another's association", async () => {
    registerOrgScopeStore(fakeStore(ORG_A));
    const oauthQuery = new URLSearchParams({ code_challenge: CHALLENGE }).toString();
    await resolveMcpOrgScope(
      request({
        url: '/auth/oauth2/consent',
        body: { oauth_query: oauthQuery },
        cookie: OTHER_COOKIE,
      }),
    );
    expect(recalls).toEqual([keysOf(OTHER_COOKIE, CHALLENGE)]);
    expect(recalls[0]!.session).not.toBe(keysOf(COOKIE, CHALLENGE).session);
  });

  it('resolves no org when the association is missing', async () => {
    registerOrgScopeStore(fakeStore(null));
    const oauthQuery = new URLSearchParams({ code_challenge: CHALLENGE }).toString();
    const scope = await resolveMcpOrgScope(
      request({ url: '/auth/oauth2/consent', body: { oauth_query: oauthQuery }, cookie: COOKIE }),
    );
    expect(scope.resource).toBeNull();
  });

  it('resolves no org for a request that carries no challenge to look one up by', async () => {
    registerOrgScopeStore(fakeStore(ORG_A));
    const scope = await resolveMcpOrgScope(
      request({ url: '/auth/oauth2/token', body: { grant_type: 'refresh_token' }, cookie: COOKIE }),
    );
    expect(scope.resource).toBeNull();
    expect(recalls).toEqual([]);
  });

  it('falls back to the default org instead of failing when the store is unavailable', async () => {
    registerOrgScopeStore(fakeStore(null, true));
    const oauthQuery = new URLSearchParams({ code_challenge: CHALLENGE }).toString();
    await expect(
      resolveMcpOrgScope(
        request({ url: '/auth/oauth2/consent', body: { oauth_query: oauthQuery }, cookie: COOKIE }),
      ),
    ).resolves.toEqual({ resource: null });
  });

  it('still resolves the requested org when the association cannot be written', async () => {
    registerOrgScopeStore(fakeStore(null, true));
    const resource = `https://mcp.example.test/mcp/o/${ORG_A}`;
    await expect(
      resolveMcpOrgScope(
        request({ query: { resource, code_challenge: CHALLENGE }, cookie: COOKIE }),
      ),
    ).resolves.toEqual({ resource });
  });

  it('ignores a non-org-scoped resource', async () => {
    registerOrgScopeStore(fakeStore());
    const scope = await resolveMcpOrgScope(
      request({
        query: { resource: 'https://mcp.example.test/mcp', code_challenge: CHALLENGE },
        cookie: COOKIE,
      }),
    );
    expect(scope.resource).toBeNull();
  });
});
