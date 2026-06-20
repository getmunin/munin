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
import { AppModule } from '../../app.module.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run KB transfer integration tests.';

(skipReason ? describe.skip : describe)('KB transfer: export org A → import org B via /mcp', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgAId: string;
  let orgBId: string;
  let adminKeyA: string;
  let adminKeyB: string;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';

    await runMigrations(TEST_URL!);
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const [orgA] = await db.insert(schema.orgs).values({ name: 'Transfer Source Org' }).returning();
    const [orgB] = await db.insert(schema.orgs).values({ name: 'Transfer Target Org' }).returning();
    orgAId = orgA!.id;
    orgBId = orgB!.id;

    adminKeyA = buildApiKey('admin');
    adminKeyB = buildApiKey('admin');
    await db.insert(schema.apiKeys).values([
      {
        orgId: orgAId,
        type: 'admin',
        name: 'transfer-admin-a',
        keyHash: hashSecret(adminKeyA),
        keyPrefix: keyPrefix(adminKeyA),
        scopes: ['*'],
      },
      {
        orgId: orgBId,
        type: 'admin',
        name: 'transfer-admin-b',
        keyHash: hashSecret(adminKeyB),
        keyPrefix: keyPrefix(adminKeyB),
        scopes: ['*'],
      },
    ]);

    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id in (${orgAId}, ${orgBId})`);
    }
  });

  async function withClient<T>(token: string, fn: (c: Client) => Promise<T>): Promise<T> {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const c = new Client({ name: 'kb-transfer-it', version: '0.0.0' });
    await c.connect(transport);
    try {
      return await fn(c);
    } finally {
      await transport.close();
      await c.close();
    }
  }

  function firstJson(result: { content: Array<{ type: string; text?: string }> }): unknown {
    for (const item of result.content) {
      if (item.type === 'text' && typeof item.text === 'string') {
        try {
          return JSON.parse(item.text);
        } catch {
          return item.text;
        }
      }
    }
    return null;
  }

  interface KbExportData {
    spaces: Array<{ id: string; slug: string }>;
    documents: Array<{ id: string; spaceId: string; slug: string | null; title: string }>;
  }
  interface ImportResult {
    created: number;
    updated: number;
    skipped: number;
    idMap: Record<string, string>;
    warnings: string[];
  }

  it('moves spaces + documents to a different org, remaps ids, re-embeds, and re-imports idempotently', async () => {
    const seeded = await withClient(adminKeyA, async (c) => {
      const spaceRes = await c.callTool({
        name: 'kb_create_space',
        arguments: { name: 'Handbook', slug: 'handbook', description: 'Company handbook.' },
      });
      const space = firstJson(spaceRes as never) as { id: string };

      await c.callTool({
        name: 'kb_create_document',
        arguments: {
          spaceId: space.id,
          title: 'Refund policy',
          slug: 'refund-policy',
          body: 'Refunds are processed within 30 days of purchase.',
          audiences: ['admin', 'self_service'],
          tags: ['policy'],
        },
      });
      await c.callTool({
        name: 'kb_create_document',
        arguments: {
          spaceId: space.id,
          title: 'Onboarding checklist',
          body: 'Step one: set up your workstation.',
          audiences: ['admin'],
        },
      });

      const exported = firstJson((await c.callTool({ name: 'kb_export', arguments: {} })) as never) as KbExportData;
      return { space, exported };
    });

    expect(seeded.exported.spaces.length).toBe(1);
    expect(seeded.exported.documents.length).toBe(2);
    const srcSpaceId = seeded.exported.spaces[0]!.id;
    const srcDocIds = seeded.exported.documents.map((d) => d.id);

    const firstImport = await withClient(adminKeyB, async (c) => {
      const res = await c.callTool({ name: 'kb_import', arguments: { records: seeded.exported } });
      const result = firstJson(res as never) as ImportResult;

      const searched = await c.callTool({ name: 'kb_search', arguments: { query: 'refund processed' } });
      const hits = firstJson(searched as never) as Array<{ documentId: string }>;
      const spaces = firstJson((await c.callTool({ name: 'kb_list_spaces', arguments: {} })) as never) as Array<{
        id: string;
        slug: string;
      }>;
      return { result, hits, spaces };
    });

    expect(firstImport.result.created).toBe(3);
    expect(firstImport.result.idMap[srcSpaceId]).toMatch(/^ksp_/);
    expect(firstImport.result.idMap[srcSpaceId]).not.toBe(srcSpaceId);
    for (const srcDocId of srcDocIds) {
      expect(firstImport.result.idMap[srcDocId]).toMatch(/^kdoc_/);
    }
    expect(firstImport.spaces.some((s) => s.slug === 'handbook')).toBe(true);
    expect(firstImport.hits.length).toBeGreaterThanOrEqual(1);

    const secondImport = await withClient(adminKeyB, async (c) => {
      const res = await c.callTool({ name: 'kb_import', arguments: { records: seeded.exported } });
      const result = firstJson(res as never) as ImportResult;
      const spaces = firstJson((await c.callTool({ name: 'kb_list_spaces', arguments: {} })) as never) as Array<unknown>;
      const docs = firstJson(
        (await c.callTool({ name: 'kb_list_documents', arguments: {} })) as never,
      ) as Array<unknown>;
      return { result, spaceCount: spaces.length, docCount: docs.length };
    });

    expect(secondImport.result.created).toBe(0);
    expect(secondImport.result.skipped).toBe(3);
    expect(secondImport.spaceCount).toBe(1);
    expect(secondImport.docCount).toBe(2);
  });
});
