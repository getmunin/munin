import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { buildApiKey, hashSecret, keyPrefix, randomToken } from '@munin/core';
import { createDb, runMigrations, schema } from '@munin/db';
import { sql } from 'drizzle-orm';
import { AppModule } from '../app.module.js';

const TEST_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set DATABASE_URL or TEST_DATABASE_URL to a Postgres URL to run MCP integration tests.';

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
    const ts = Date.now();
    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'MCP IT Org', slug: `mcp-it-${ts}` })
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
    endUserToken = randomToken(32);
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
      expect(names).toContain('bootstrap_status');
      expect(names).toContain('suggestion_create');
      expect(names).toContain('ping');

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
            public: true,
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
            public: false,
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
        expect(names).not.toContain('suggestion_create');
        expect(names).not.toContain('bootstrap_status');

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
