import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { eq, inArray, like } from 'drizzle-orm';
import { createMuninAuthCore } from './auth-factory.ts';
import { handleAuthRequest } from '../auth-controller-factory.ts';
import type { McpSurface } from '../oauth/mcp-surface.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run the OAuth token flow test.';

const AS_URL = 'http://localhost:3001';
const MCP_URL = 'http://localhost:3001/mcp';
const REDIRECT_URI = 'https://client.example.com/callback';
const EMAIL = 'oauth-flow-test@example.test';
const ORG_ID = 'org_oauthflowtest000000001';
const PASSWORD = 'correct-horse-battery-staple-99';

const MEDIA_SURFACE: McpSurface = {
  id: 'media',
  path: '/mcp/media',
  resourceName: 'Munin Media Tools',
  scopes: ['mcp:admin', 'media:write'],
};

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

const decodeClaims = (jwtToken: string): Record<string, unknown> => {
  const payload = jwtToken.split('.')[1]!;
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
};

(skipReason ? describe.skip : describe)('oauth authorization code flow with resource indicators', () => {
  const priorEnv: Record<string, string | undefined> = {};
  let db: ReturnType<typeof createDb>;
  let auth: ReturnType<typeof createMuninAuthCore>;
  let clientId: string;
  let sessionCookie: string;
  let userId: string;
  let pkceSeq = 0;

  const bridge = async (
    path: string,
    init: { method?: string; body?: unknown; cookie?: string; form?: boolean } = {},
  ) => {
    const [pathname, search = ''] = path.split('?');
    const query = Object.fromEntries(new URLSearchParams(search).entries());
    const method = init.method ?? 'GET';
    const req = {
      method,
      originalUrl: path,
      url: path,
      query,
      body: init.body,
      headers: {
        host: 'localhost:3001',
        ...(init.body
          ? {
              'content-type': init.form
                ? 'application/x-www-form-urlencoded'
                : 'application/json',
            }
          : {}),
        ...(init.cookie ? { cookie: init.cookie } : {}),
      },
      protocol: 'http',
      get: (name: string) => (name.toLowerCase() === 'host' ? 'localhost:3001' : undefined),
      rawBody: init.body
        ? Buffer.from(
            init.form
              ? new URLSearchParams(init.body as Record<string, string>).toString()
              : JSON.stringify(init.body),
            'utf8',
          )
        : undefined,
    };
    const captured = {
      status: 0,
      headers: {} as Record<string, string>,
      setCookies: [] as string[],
      body: '',
      pathname,
    };
    const res = {
      status(code: number) {
        captured.status = code;
        return this;
      },
      setHeader(name: string, value: string | string[]) {
        const key = name.toLowerCase();
        if (key === 'set-cookie') {
          captured.setCookies = Array.isArray(value) ? value : [value];
          return;
        }
        captured.headers[key] = Array.isArray(value) ? value.join(', ') : value;
      },
      send(body: string) {
        captured.body = body;
      },
    };
    await handleAuthRequest(
      auth,
      req as unknown as Parameters<typeof handleAuthRequest>[1],
      res as unknown as Parameters<typeof handleAuthRequest>[2],
    );
    return captured;
  };

  const newPkce = async () => {
    const { createHash } = await import('node:crypto');
    const verifier = `verifier-${(pkceSeq += 1)}-zN3xQ9bN2mL8wF6rE7tH0jU5oZ4kPyV1c3`;
    return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
  };

  const grant = async (resource: string): Promise<TokenResponse> => {
    const { verifier, challenge } = await newPkce();
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      scope: 'offline_access mcp:admin',
      state: 'flow-state',
      resource,
    });
    const started = await bridge(`/auth/oauth2/authorize?${params.toString()}`, {
      cookie: sessionCookie,
    });
    expect(started.body, `authorize rejected: ${started.body.slice(0, 300)}`).not.toContain(
      'error',
    );

    let redirect = started.headers['location'] ?? '';
    if (!/[?&]code=/.test(redirect)) {
      const at = redirect.indexOf('?');
      const signedQuery = at < 0 ? '' : redirect.slice(at + 1);
      const accepted = await bridge('/auth/oauth2/consent', {
        method: 'POST',
        cookie: sessionCookie,
        body: { accept: true, oauth_query: signedQuery },
      });
      redirect = accepted.headers['location'] ?? accepted.body;
    }
    const match = /[?&]code=([^&"]+)/.exec(redirect);
    expect(match, `no code in authorization response: ${redirect.slice(0, 400)}`).toBeTruthy();

    const res = await bridge('/auth/oauth2/token', {
      method: 'POST',
      form: true,
      body: {
        grant_type: 'authorization_code',
        code: decodeURIComponent(match![1]!),
        redirect_uri: REDIRECT_URI,
        client_id: clientId,
        code_verifier: verifier,
        resource,
      },
    });
    return JSON.parse(res.body) as TokenResponse;
  };

  const refresh = async (refreshToken: string, resource: string): Promise<TokenResponse> => {
    const res = await bridge('/auth/oauth2/token', {
      method: 'POST',
      form: true,
      body: {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        resource,
      },
    });
    return JSON.parse(res.body) as TokenResponse;
  };

  beforeAll(async () => {
    priorEnv['NEXT_PUBLIC_MCP_URL'] = process.env.NEXT_PUBLIC_MCP_URL;
    priorEnv['NEXT_PUBLIC_AUTH_URL'] = process.env.NEXT_PUBLIC_AUTH_URL;
    process.env.NEXT_PUBLIC_MCP_URL = MCP_URL;
    process.env.NEXT_PUBLIC_AUTH_URL = AS_URL;

    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!);
    await db.delete(schema.users).where(eq(schema.users.email, EMAIL));
    await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG_ID));
    await db.delete(schema.jwks);

    auth = createMuninAuthCore({
      db,
      baseUrl: AS_URL,
      authSecret: 'integration-test-secret-000000000000000000',
      mcpSurfaces: [MEDIA_SURFACE],
    });

    const registered = await bridge('/auth/oauth2/register', {
      method: 'POST',
      body: {
        client_name: 'token-flow-test',
        redirect_uris: [REDIRECT_URI],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
    });
    clientId = (JSON.parse(registered.body) as { client_id: string }).client_id;

    const signedUp = await bridge('/auth/sign-up/email', {
      method: 'POST',
      body: { email: EMAIL, password: PASSWORD, name: 'OAuth Flow Test' },
    });
    sessionCookie = signedUp.setCookies
      .map((cookie) => cookie.split(';')[0])
      .filter(Boolean)
      .join('; ');
    expect(sessionCookie, `sign-up produced no cookie: ${signedUp.body.slice(0, 300)}`).toBeTruthy();

    const [user] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, EMAIL));
    userId = user!.id;

    await db.insert(schema.orgs).values({ id: ORG_ID, name: 'OAuth Flow Test Org' });
    await db
      .insert(schema.orgMembers)
      .values({ orgId: ORG_ID, userId, role: 'owner', isDefault: true });
  });

  afterAll(async () => {
    if (clientId) {
      await db.delete(schema.oauthClient).where(inArray(schema.oauthClient.clientId, [clientId]));
    }
    if (userId) await db.delete(schema.users).where(eq(schema.users.id, userId));
    await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG_ID));
    await db
      .delete(schema.verifications)
      .where(like(schema.verifications.identifier, 'mcp-org-scope:%'));
    for (const [key, value] of Object.entries(priorEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('mints an access token audienced to the base MCP resource', async () => {
    const token = await grant(MCP_URL);
    expect(token.error, token.error_description).toBeUndefined();
    expect(token.access_token).toBeTruthy();
    expect(decodeClaims(token.access_token!)['aud']).toBe(MCP_URL);
  });

  it('mints an access token for the media surface', async () => {
    const token = await grant(`${AS_URL}/mcp/media`);
    expect(token.error, token.error_description).toBeUndefined();
    expect(decodeClaims(token.access_token!)['aud']).toBe(`${AS_URL}/mcp/media`);
  });

  it('pins an org-scoped resource to that org while audiencing the narrowed base', async () => {
    const token = await grant(`${MCP_URL}/o/${ORG_ID}`);
    expect(token.error, token.error_description).toBeUndefined();
    const claims = decodeClaims(token.access_token!);
    expect(claims['aud']).toBe(MCP_URL);
    expect(claims['org_id']).toBe(ORG_ID);
  });

  it('refuses an org the signed-in user is not a member of', async () => {
    const { challenge } = await newPkce();
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      scope: 'offline_access mcp:admin',
      state: 'flow-state',
      resource: `${MCP_URL}/o/org_notamemberofthisorgabc`,
    });
    const started = await bridge(`/auth/oauth2/authorize?${params.toString()}`, {
      cookie: sessionCookie,
    });
    expect(started.body).toContain('access_denied');
    expect(started.body).not.toContain('invalid_target');
  });

  it('exchanges a refresh token for a fresh access token', async () => {
    const first = await grant(MCP_URL);
    expect(first.refresh_token, 'no refresh token issued').toBeTruthy();
    const refreshed = await refresh(first.refresh_token!, MCP_URL);
    expect(refreshed.error, refreshed.error_description).toBeUndefined();
    expect(refreshed.access_token).toBeTruthy();
    expect(decodeClaims(refreshed.access_token!)['aud']).toBe(MCP_URL);
  });

  it('refreshes a token pinned to an org-scoped resource, keeping the org', async () => {
    const orgScoped = `${MCP_URL}/o/${ORG_ID}`;
    const first = await grant(orgScoped);
    expect(first.refresh_token).toBeTruthy();
    const refreshed = await refresh(first.refresh_token!, orgScoped);
    expect(refreshed.error, refreshed.error_description).toBeUndefined();
    const claims = decodeClaims(refreshed.access_token!);
    expect(claims['aud']).toBe(MCP_URL);
    expect(claims['org_id']).toBe(ORG_ID);
  });
});
