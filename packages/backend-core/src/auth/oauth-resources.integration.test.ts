import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { inArray } from 'drizzle-orm';
import { createMuninAuthCore } from './auth-factory.ts';
import { handleAuthRequest } from '../auth-controller-factory.ts';
import type { McpSurface } from '../oauth/mcp-surface.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run OAuth resource registry tests.';

const AS_URL = 'http://localhost:3001';
const MCP_URL = 'http://localhost:3001/mcp';
const MEDIA_RESOURCE = 'http://localhost:3001/mcp/media';
const REDIRECT_URI = 'https://client.example.com/callback';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

const MEDIA_SURFACE: McpSurface = {
  id: 'media',
  path: '/mcp/media',
  resourceName: 'Munin Media Tools',
  scopes: ['mcp:admin', 'media:write'],
};

(skipReason ? describe.skip : describe)('oauth resource indicators', () => {
  const priorEnv: Record<string, string | undefined> = {};
  const registeredClientIds: string[] = [];
  let db: ReturnType<typeof createDb>;
  let auth: ReturnType<typeof createMuninAuthCore>;
  let clientId: string;

  const registerClient = async (name: string): Promise<string> => {
    const res = await auth.handler(
      new Request(`${AS_URL}/auth/oauth2/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: name,
          redirect_uris: [REDIRECT_URI],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        }),
      }),
    );
    const body = (await res.json()) as { client_id: string };
    registeredClientIds.push(body.client_id);
    return body.client_id;
  };

  const authorize = async (resource: string | null, asClient = clientId) => {
    const params = new URLSearchParams({
      client_id: asClient,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      code_challenge: CHALLENGE,
      code_challenge_method: 'S256',
      scope: 'offline_access mcp:admin',
      state: 'test-state',
    });
    if (resource) params.set('resource', resource);
    const res = await auth.handler(
      new Request(`${AS_URL}/auth/oauth2/authorize?${params.toString()}`, { method: 'GET' }),
    );
    return {
      status: res.status,
      location: res.headers.get('location') ?? '',
      body: await res.text(),
    };
  };

  const expectReachesLogin = (result: { status: number; location: string; body: string }) => {
    expect(result.body).not.toContain('invalid_target');
    expect(result.location).toContain('/login');
  };

  beforeAll(async () => {
    priorEnv['NEXT_PUBLIC_MCP_URL'] = process.env.NEXT_PUBLIC_MCP_URL;
    priorEnv['NEXT_PUBLIC_AUTH_URL'] = process.env.NEXT_PUBLIC_AUTH_URL;
    process.env.NEXT_PUBLIC_MCP_URL = MCP_URL;
    process.env.NEXT_PUBLIC_AUTH_URL = AS_URL;
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!);
    auth = createMuninAuthCore({
      db,
      baseUrl: AS_URL,
      authSecret: 'integration-test-secret-000000000000000000',
      mcpSurfaces: [MEDIA_SURFACE],
    });
    clientId = await registerClient('resource-registry-test');
  });

  afterAll(async () => {
    if (registeredClientIds.length) {
      await db
        .delete(schema.oauthClient)
        .where(inArray(schema.oauthClient.clientId, registeredClientIds));
    }
    for (const [key, value] of Object.entries(priorEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('sends an unscoped authorize request to the login page', async () => {
    expectReachesLogin(await authorize(null));
  });

  it('accepts the base MCP resource as a resource indicator', async () => {
    expectReachesLogin(await authorize(MCP_URL));
  });

  it('accepts a registered surface resource', async () => {
    expectReachesLogin(await authorize(MEDIA_RESOURCE));
  });

  it('accepts the authorization server as its own resource', async () => {
    expectReachesLogin(await authorize(AS_URL));
  });

  it('accepts the trailing-slash variant of a resource', async () => {
    expectReachesLogin(await authorize(`${MCP_URL}/`));
  });

  it('rejects a resource that belongs to nobody', async () => {
    const result = await authorize('https://evil.example.com/mcp');
    expect(result.status).toBe(400);
    expect(result.body).toContain('invalid_target');
    expect(result.body).toContain('is not configured');
  });

  it('lets a freshly registered client request a resource without an explicit link', async () => {
    const other = await registerClient('second-resource-registry-test');
    expectReachesLogin(await authorize(MCP_URL, other));
  });

  describe('through the express bridge, as a real connector arrives', () => {
    const throughBridge = async (resource: string) => {
      const query = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: REDIRECT_URI,
        code_challenge: CHALLENGE,
        code_challenge_method: 'S256',
        scope: 'offline_access mcp:admin',
        state: 'test-state',
        resource,
      });
      const originalUrl = `/auth/oauth2/authorize?${query.toString()}`;
      const req = {
        method: 'GET',
        originalUrl,
        url: originalUrl,
        query: Object.fromEntries(query.entries()),
        headers: { host: 'localhost:3001' },
        protocol: 'http',
        get: (name: string) => (name.toLowerCase() === 'host' ? 'localhost:3001' : undefined),
      };
      const captured = { status: 0, headers: {} as Record<string, string>, body: '' };
      const res = {
        status(code: number) {
          captured.status = code;
          return this;
        },
        setHeader(name: string, value: string) {
          captured.headers[name.toLowerCase()] = value;
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

    it('accepts an org-scoped MCP resource by narrowing it to the base resource', async () => {
      const result = await throughBridge(`${MCP_URL}/o/org_inodqg25xaq1l0ram6j1mz`);
      expect(result.body).not.toContain('invalid_target');
      expect(result.headers['location']).toContain('/login');
    });

    it('accepts an org-scoped surface resource by narrowing it to that surface', async () => {
      const result = await throughBridge(`${MEDIA_RESOURCE}/o/org_inodqg25xaq1l0ram6j1mz`);
      expect(result.body).not.toContain('invalid_target');
      expect(result.headers['location']).toContain('/login');
    });

    it('still rejects a foreign org-scoped resource', async () => {
      const result = await throughBridge('https://evil.example.com/mcp/o/org_inodqg25xaq1l0ram6j1');
      expect(result.body).toContain('invalid_target');
    });
  });

  it('seeds an oauth_resource row for every advertised identifier', async () => {
    await authorize(MCP_URL);
    const rows = await db
      .select({ identifier: schema.oauthResource.identifier })
      .from(schema.oauthResource)
      .where(inArray(schema.oauthResource.identifier, [MCP_URL, MEDIA_RESOURCE, AS_URL]));
    expect(rows.map((row) => row.identifier).sort()).toEqual(
      [MCP_URL, MEDIA_RESOURCE, AS_URL].sort(),
    );
  });
});
