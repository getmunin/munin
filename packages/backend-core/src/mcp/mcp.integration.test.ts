import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { buildApiKey, hashSecret, keyPrefix } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { AppModule } from '../app.module.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run MCP integration tests.';

(skipReason ? describe.skip : describe)('MCP integration: KB end-to-end', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let adminKey: string;
  let endUserToken: string;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';

    await runMigrations(TEST_URL!);

    // Postgres superusers always bypass RLS — the integration test must boot
    // Nest with the non-superuser munin_app role so the RLS policies actually
    // apply to delegated end-user requests.
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });

    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'MCP IT Org' })
      .returning();
    orgId = org!.id;

    adminKey = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId,
      type: 'admin',
      name: 'mcp-it',
      keyHash: hashSecret(adminKey),
      keyPrefix: keyPrefix(adminKey),
      scopes: ['*'],
    });

    const [endUser] = await db
      .insert(schema.endUsers)
      .values({ orgId, externalId: 'eu-1', name: 'EU One' })
      .returning();
    endUserToken = buildApiKey('dlg');
    await db.insert(schema.tokens).values({
      orgId,
      type: 'delegated_end_user',
      tokenHash: hashSecret(endUserToken),
      scopes: ['kb:read'],
      audiences: ['self_service'],
      endUserId: endUser!.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('expected an AddressInfo from app.getHttpServer()');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  async function withClient<T>(token: string, fn: (c: Client) => Promise<T>): Promise<T> {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const c = new Client({ name: 'munin-it', version: '0.0.0' });
    await c.connect(transport);
    try {
      return await fn(c);
    } finally {
      await transport.close();
      await c.close();
    }
  }

  it('admin can list tools and exercise the full KB flow', async () => {
    await withClient(adminKey, async (c) => {
      const { tools } = await c.listTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toContain('kb_create_space');
      expect(names).toContain('kb_create_document');
      expect(names).toContain('kb_search');
      expect(names).toContain('ping');
      expect(names).not.toContain('feedback_create');

      for (const t of tools) {
        expect(t.annotations, `tool ${t.name} missing annotations`).toBeDefined();
        expect(t.annotations!.title, `tool ${t.name} missing title`).toBeTruthy();
        expect(typeof t.annotations!.readOnlyHint).toBe('boolean');
        expect(typeof t.annotations!.destructiveHint).toBe('boolean');
      }
      const kbDelete = tools.find((t) => t.name === 'kb_delete_document')!;
      expect(kbDelete.annotations!.readOnlyHint).toBe(false);
      expect(kbDelete.annotations!.destructiveHint).toBe(true);
      const kbSearch = tools.find((t) => t.name === 'kb_search')!;
      expect(kbSearch.annotations!.readOnlyHint).toBe(true);
      expect(kbSearch.annotations!.destructiveHint).toBe(false);

      const ping = await c.callTool({ name: 'ping', arguments: { message: 'hi' } });
      expect(JSON.stringify(ping)).toContain('hi');

      const space = parseToolResult<{ id: string }>(
        await c.callTool({
          name: 'kb_create_space',
          arguments: { name: 'Engineering', slug: 'engineering' },
        }),
      );

      const publicDoc = parseToolResult<{ id: string; version: number }>(
        await c.callTool({
          name: 'kb_create_document',
          arguments: {
            spaceId: space.id,
            title: 'Public help',
            body: 'How to reset your password — click the reset link.',
            public: true,
          },
        }),
      );

      const privateDoc = parseToolResult<{ id: string; version: number }>(
        await c.callTool({
          name: 'kb_create_document',
          arguments: {
            spaceId: space.id,
            title: 'Internal runbook',
            body: 'Engineers only. Restart the queue with `pm2 restart`.',
            public: false,
          },
        }),
      );

      const adminHits = parseToolResult<Array<{ documentId: string; title: string }>>(
        await c.callTool({ name: 'kb_search', arguments: { query: 'password reset' } }),
      );
      const adminTitles = adminHits.map((h) => h.title);
      expect(adminTitles).toContain('Public help');

      // Cleanup so this test doesn't leak documents.
      await c.callTool({
        name: 'kb_delete_document',
        arguments: { id: privateDoc.id, ifVersion: privateDoc.version },
      });
      await c.callTool({
        name: 'kb_delete_document',
        arguments: { id: publicDoc.id, ifVersion: publicDoc.version },
      });
    });
  }, 30_000);

  it('admin sees skills via resources/list and can read them', async () => {
    await withClient(adminKey, async (c) => {
      const { resources } = await c.listResources();
      const uris = resources.map((r) => r.uri);
      expect(uris).toContain('skill://conv/setup-email-channel');
      expect(uris).toContain('skill://crm/onboard-new-customer');

      const read = await c.readResource({ uri: 'skill://conv/setup-email-channel' });
      const first = read.contents[0];
      expect(first?.mimeType).toBe('text/markdown');
      const text = first && 'text' in first ? first.text : '';
      expect(text).toContain('Set up an email channel');
    });
  });

  it('end-user agent does not see admin-only skills', async () => {
    await withClient(endUserToken, async (c) => {
      const { resources } = await c.listResources();
      const uris = resources.map((r) => r.uri);
      expect(uris).not.toContain('skill://conv/setup-email-channel');
    });
  });

  it('reading an unknown resource URI errors', async () => {
    await withClient(adminKey, async (c) => {
      await expect(c.readResource({ uri: 'skill://does/not-exist' })).rejects.toThrow(
        /Unknown resource/,
      );
    });
  });

  it('scope gating: an admin key without kb:write cannot call kb_create_document', async () => {
    const limitedKey = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId,
      type: 'admin',
      name: 'mcp-it-limited',
      keyHash: hashSecret(limitedKey),
      keyPrefix: keyPrefix(limitedKey),
      scopes: ['kb:read'], // read-only, no kb:write, no '*'
    });

    await withClient(limitedKey, async (c) => {
      // listTools intersects both audience and scope: kb_search is listed
      // (caller has kb:read) but kb_create_document is hidden (no kb:write).
      const { tools } = await c.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('kb_search');
      expect(names).not.toContain('kb_create_document');

      // kb_search works (kb:read).
      const search = await c.callTool({ name: 'kb_search', arguments: { query: 'anything' } });
      expect(JSON.stringify(search)).not.toMatch(/Missing required scope/);

      // Defense in depth: even when invoked by name, kb_create_document is
      // denied at dispatch with a scope error.
      const denied = await c.callTool({
        name: 'kb_create_document',
        arguments: {
          spaceId: '00000000-0000-0000-0000-000000000000',
          title: 'should not happen',
          body: 'no',
        },
      }) as { isError?: boolean; content?: Array<{ text?: string }> };
      expect(denied.isError).toBe(true);
      expect(denied.content?.[0]?.text ?? '').toMatch(/Missing required scope: kb:write/);
    });
  }, 30_000);

  it('audit log: a scope-denied call writes a result=denied row with the scope error', async () => {
    const auditKey = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId,
      type: 'admin',
      name: 'mcp-it-audit',
      keyHash: hashSecret(auditKey),
      keyPrefix: keyPrefix(auditKey),
      scopes: ['kb:read'], // missing kb:write — kb_create_document will be denied
    });

    await withClient(auditKey, async (c) => {
      const denied = (await c.callTool({
        name: 'kb_create_document',
        arguments: {
          spaceId: '00000000-0000-0000-0000-000000000000',
          title: 'x',
          body: 'x',
        },
      })) as { isError?: boolean };
      expect(denied.isError).toBe(true);
    });

    // Audit row written by createMcpServer's deny path. Read with bypass on so
    // we can see the row regardless of org GUC state.
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const rows = await db
      .select({ tool: schema.auditLog.tool, result: schema.auditLog.result, error: schema.auditLog.error })
      .from(schema.auditLog)
      .where(sql`org_id = ${orgId} AND tool = 'kb_create_document' AND result = 'denied'`);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => (r.error ?? '').includes('missing_scope:kb:write'))).toBe(true);
  }, 30_000);

  it('scope gating: an admin key with empty scopes is denied even on kb:read tools', async () => {
    const noScopesKey = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId,
      type: 'admin',
      name: 'mcp-it-no-scopes',
      keyHash: hashSecret(noScopesKey),
      keyPrefix: keyPrefix(noScopesKey),
      scopes: [],
    });

    await withClient(noScopesKey, async (c) => {
      const denied = await c.callTool({
        name: 'kb_search',
        arguments: { query: 'whatever' },
      }) as { isError?: boolean; content?: Array<{ text?: string }> };
      expect(denied.isError).toBe(true);
      expect(denied.content?.[0]?.text ?? '').toMatch(/Missing required scope: kb:read/);

      // ping has no scope requirement — still works for the same actor.
      const ping = await c.callTool({ name: 'ping', arguments: { message: 'ok' } });
      expect(JSON.stringify(ping)).toContain('ok');
    });
  }, 30_000);

  it('rate limit: per-day cap is enforced and the second call returns rate_limited', async () => {
    const [rlOrg] = await db
      .insert(schema.orgs)
      .values({
        name: 'RL Org',
        settings: { rateLimits: { perDay: 1 } },
      })
      .returning();
    const rlAdminKey = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId: rlOrg!.id,
      type: 'admin',
      name: 'rl-admin',
      keyHash: hashSecret(rlAdminKey),
      keyPrefix: keyPrefix(rlAdminKey),
      scopes: ['*'],
    });

    try {
      await withClient(rlAdminKey, async (c) => {
        const first = await c.callTool({ name: 'ping', arguments: { message: 'a' } });
        expect(JSON.stringify(first)).toContain('a');

        const second = await c.callTool({ name: 'ping', arguments: { message: 'b' } }) as {
          isError?: boolean;
          content?: Array<{ text?: string }>;
        };
        expect(second.isError).toBe(true);
        expect(second.content?.[0]?.text ?? '').toMatch(/rate_limited/);
      });
    } finally {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${rlOrg!.id}`);
    }
  }, 30_000);

  it('expired bearer token is rejected at connect (401)', async () => {
    const expired = buildApiKey('dlg');
    await db.insert(schema.tokens).values({
      orgId,
      type: 'delegated_end_user',
      tokenHash: hashSecret(expired),
      scopes: ['kb:read'],
      audiences: ['self_service'],
      expiresAt: new Date(Date.now() - 60_000),
    });

    await expect(
      withClient(expired, async (c) => {
        await c.listTools();
      }),
    ).rejects.toThrow();
  }, 30_000);

  it('revoked bearer token is rejected at connect (401)', async () => {
    const revoked = buildApiKey('dlg');
    await db.insert(schema.tokens).values({
      orgId,
      type: 'delegated_end_user',
      tokenHash: hashSecret(revoked),
      scopes: ['kb:read'],
      audiences: ['self_service'],
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: new Date(),
    });

    await expect(
      withClient(revoked, async (c) => {
        await c.listTools();
      }),
    ).rejects.toThrow();
  }, 30_000);

  it('end-user agent sees only self-service tools and only public docs', async () => {
    // First seed a public + a private doc as admin.
    let publicDocId = '';
    let privateDocId = '';
    let publicVer = 0;
    let privateVer = 0;
    let spaceId = '';
    await withClient(adminKey, async (c) => {
      const space = parseToolResult<{ id: string }>(
        await c.callTool({
          name: 'kb_create_space',
          arguments: { name: 'Self', slug: 'self' },
        }),
      );
      spaceId = space.id;
      const pub = parseToolResult<{ id: string; version: number }>(
        await c.callTool({
          name: 'kb_create_document',
          arguments: {
            spaceId,
            title: 'Public FAQ',
            body: 'Public answer about widgets.',
            audiences: ['admin', 'self_service'],
          },
        }),
      );
      publicDocId = pub.id;
      publicVer = pub.version;
      const priv = parseToolResult<{ id: string; version: number }>(
        await c.callTool({
          name: 'kb_create_document',
          arguments: {
            spaceId,
            title: 'Private widgets',
            body: 'Internal widget secrets.',
            audiences: ['admin'],
          },
        }),
      );
      privateDocId = priv.id;
      privateVer = priv.version;
    });

    try {
      await withClient(endUserToken, async (c) => {
        const { tools } = await c.listTools();
        const names = tools.map((t) => t.name);
        expect(names).toContain('kb_search');
        expect(names).toContain('kb_get_document');
        expect(names).not.toContain('kb_create_document');
        expect(names).not.toContain('kb_delete_document');
        expect(names).not.toContain('feedback_create');

        const hits = parseToolResult<Array<{ documentId: string; title: string }>>(
          await c.callTool({ name: 'kb_search', arguments: { query: 'widgets' } }),
        );
        const titles = hits.map((h) => h.title);
        expect(titles).toContain('Public FAQ');
        expect(titles).not.toContain('Private widgets');
      });
    } finally {
      await withClient(adminKey, async (c) => {
        await c
          .callTool({
            name: 'kb_delete_document',
            arguments: { id: privateDocId, ifVersion: privateVer },
          })
          .catch(() => {});
        await c
          .callTool({
            name: 'kb_delete_document',
            arguments: { id: publicDocId, ifVersion: publicVer },
          })
          .catch(() => {});
      });
    }
  }, 30_000);
});

function parseToolResult<T>(result: unknown): T {
  const r = result as { content?: Array<{ type: string; text?: string }> };
  const text = r.content?.[0]?.text ?? '';
  return JSON.parse(text) as T;
}
