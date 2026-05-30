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
  : 'Set TEST_DATABASE_URL to a Postgres URL to run KB integration tests.';

(skipReason ? describe.skip : describe)('KB integration: document lifecycle via /mcp', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let adminKey: string;

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

    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'KB IT Org' })
      .returning();
    orgId = org!.id;

    adminKey = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId,
      type: 'admin',
      name: 'kb-it-admin',
      keyHash: hashSecret(adminKey),
      keyPrefix: keyPrefix(adminKey),
      scopes: ['*'],
    });

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
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  async function withClient<T>(token: string, fn: (c: Client) => Promise<T>): Promise<T> {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const c = new Client({ name: 'kb-it', version: '0.0.0' });
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

  it('full doc lifecycle: create space → create doc → search → update with ifVersion → list versions → restore', async () => {
    await withClient(adminKey, async (c) => {
      const spaceRes = await c.callTool({
        name: 'kb_create_space',
        arguments: {
          name: 'Engineering wiki',
          slug: 'engineering',
          description: 'Internal engineering docs.',
        },
      });
      const space = firstJson(spaceRes as never) as { id: string; slug: string };
      expect(space.id).toMatch(/^ksp_/);
      expect(space.slug).toBe('engineering');

      const created = await c.callTool({
        name: 'kb_create_document',
        arguments: {
          spaceId: space.id,
          title: 'How we deploy',
          slug: 'how-we-deploy',
          body: 'We use blue-green deploys with terraform.',
          audiences: ['admin'],
          tags: ['ops'],
        },
      });
      const doc = firstJson(created as never) as { id: string; version: number };
      expect(doc.id).toMatch(/^kdoc_/);
      expect(doc.version).toBe(1);

      const searched = await c.callTool({
        name: 'kb_search',
        arguments: { query: 'blue-green deploy' },
      });
      const hits = firstJson(searched as never) as Array<{ documentId: string }>;
      expect(hits.length).toBeGreaterThanOrEqual(1);
      expect(hits.some((h) => h.documentId === doc.id)).toBe(true);

      const updated = await c.callTool({
        name: 'kb_update_document',
        arguments: {
          id: doc.id,
          ifVersion: doc.version,
          body: 'We use blue-green deploys with terraform and feature flags.',
        },
      });
      const updatedDoc = firstJson(updated as never) as { version: number };
      expect(updatedDoc.version).toBe(2);

      const staleUpdate = await c.callTool({
        name: 'kb_update_document',
        arguments: {
          id: doc.id,
          ifVersion: 1,
          body: 'Stale update should fail',
        },
      });
      expect(staleUpdate.isError).toBe(true);

      const versions = await c.callTool({
        name: 'kb_list_versions',
        arguments: { documentId: doc.id },
      });
      const versionList = firstJson(versions as never) as Array<{ version: number }>;
      expect(Array.isArray(versionList), `expected array, got ${JSON.stringify(versionList)}`).toBe(true);
      expect(versionList.length).toBeGreaterThanOrEqual(1);
      expect(versionList.map((v) => v.version)).toContain(1);

      const restored = await c.callTool({
        name: 'kb_restore_version',
        arguments: { documentId: doc.id, version: 1, ifVersion: 2 },
      });
      const restoredDoc = firstJson(restored as never) as { version: number; body: string };
      expect(restoredDoc.version).toBe(3);
      expect(restoredDoc.body).toBe('We use blue-green deploys with terraform.');
    });
  });

  it('get_document_by_slug returns the doc when the slug exists', async () => {
    await withClient(adminKey, async (c) => {
      const spaceRes = await c.callTool({
        name: 'kb_create_space',
        arguments: { name: 'Lookup space', slug: 'lookup', description: 'Lookup tests.' },
      });
      const space = firstJson(spaceRes as never) as { id: string; slug: string };

      await c.callTool({
        name: 'kb_create_document',
        arguments: {
          spaceId: space.id,
          title: 'Findable by slug',
          slug: 'findable',
          body: 'This document is meant to be found.',
          audiences: ['admin'],
          tags: [],
        },
      });

      const found = await c.callTool({
        name: 'kb_get_document_by_slug',
        arguments: { spaceSlug: space.slug, slug: 'findable' },
      });
      const doc = firstJson(found as never) as { slug: string; title: string };
      expect(doc.slug).toBe('findable');
      expect(doc.title).toBe('Findable by slug');
    });
  });

  it('delete_document removes the doc and search no longer returns it', async () => {
    await withClient(adminKey, async (c) => {
      const spaceRes = await c.callTool({
        name: 'kb_create_space',
        arguments: { name: 'Trash space', slug: 'trash', description: 'Delete tests.' },
      });
      const space = firstJson(spaceRes as never) as { id: string };

      const created = await c.callTool({
        name: 'kb_create_document',
        arguments: {
          spaceId: space.id,
          title: 'Soon to be deleted',
          slug: 'doomed',
          body: 'Some text with the word "unique-marker-xqz" inside.',
          audiences: ['admin'],
          tags: [],
        },
      });
      const doc = firstJson(created as never) as { id: string; version: number };

      const beforeDelete = await c.callTool({
        name: 'kb_search',
        arguments: { query: 'unique-marker-xqz' },
      });
      const beforeHits = firstJson(beforeDelete as never) as Array<{ documentId: string }>;
      expect(Array.isArray(beforeHits)).toBe(true);

      const deleted = await c.callTool({
        name: 'kb_delete_document',
        arguments: { id: doc.id, ifVersion: doc.version },
      });
      expect(deleted.isError).not.toBe(true);

      const afterDelete = await c.callTool({
        name: 'kb_search',
        arguments: { query: 'unique-marker-xqz' },
      });
      const afterHits = firstJson(afterDelete as never) as Array<{ documentId: string }>;
      expect(Array.isArray(afterHits)).toBe(true);
      expect(afterHits.some((h) => h.documentId === doc.id)).toBe(false);
    });
  });
});
