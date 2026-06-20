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
  : 'Set TEST_DATABASE_URL to a Postgres URL to run analytics transfer integration tests.';

(skipReason ? describe.skip : describe)(
  'Analytics transfer: export org A → import org B via /mcp',
  () => {
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
      const appUrl = TEST_URL!.replace(
        /(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/,
        '$1munin_app:munin_app@',
      );
      process.env.DATABASE_URL = appUrl;

      db = createDb(TEST_URL!, { serviceRole: true });
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

      const [orgA] = await db
        .insert(schema.orgs)
        .values({ name: 'Analytics Source Org' })
        .returning();
      const [orgB] = await db
        .insert(schema.orgs)
        .values({ name: 'Analytics Target Org' })
        .returning();
      orgAId = orgA!.id;
      orgBId = orgB!.id;

      adminKeyA = buildApiKey('admin');
      adminKeyB = buildApiKey('admin');
      await db.insert(schema.apiKeys).values([
        {
          orgId: orgAId,
          type: 'admin',
          name: 'analytics-admin-a',
          keyHash: hashSecret(adminKeyA),
          keyPrefix: keyPrefix(adminKeyA),
          scopes: ['*'],
        },
        {
          orgId: orgBId,
          type: 'admin',
          name: 'analytics-admin-b',
          keyHash: hashSecret(adminKeyB),
          keyPrefix: keyPrefix(adminKeyB),
          scopes: ['*'],
        },
      ]);

      const day = (n: number) => new Date(Date.UTC(2025, 0, 1 + n)).toISOString();
      const viewRows = Array.from({ length: 4 }, (_, i) => ({
        orgId: orgAId,
        subjectType: 'cms_entry',
        subjectId: `entry-${i}`,
        source: 'tracker',
        path: `/p/${i}`,
        visitorId: `v-${i}`,
        userAgentClass: 'browser',
        createdAt: new Date(day(i)),
      }));
      await db.insert(schema.analyticsViewEvents).values(viewRows);
      await db.insert(schema.analyticsSearchEvents).values([
        {
          orgId: orgAId,
          subjectType: 'kb',
          query: 'refund policy',
          resultCount: 0,
          visitorId: 'v-search',
          createdAt: new Date(day(5)),
        },
      ]);

      app = await NestFactory.create(AppModule, { logger: false });
      await app.listen(0, '127.0.0.1');
      const server = app.getHttpServer() as {
        address(): AddressInfo | string | null;
      };
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
      const c = new Client({ name: 'analytics-transfer-it', version: '0.0.0' });
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

    interface ConfigExport {
      trackers: Array<{
        id: string;
        name: string;
        identityVerificationSecret: string | null;
      }>;
      visitorIdentities: Array<{ id: string; visitorId: string; endUserId: string }>;
    }
    interface EventsPage {
      records: {
        viewEvents: Array<{ id: string; subjectId: string }>;
        searchEvents: Array<{ id: string; query: string }>;
      };
      nextCursor: string | null;
    }
    interface ImportResult {
      created: number;
      updated: number;
      skipped: number;
      idMap: Record<string, string>;
      warnings: string[];
    }

    it('moves trackers + events to a different org, redacts secrets, paginates, and remaps ids', async () => {
      const seeded = await withClient(adminKeyA, async (c) => {
        const trackerRes = await c.callTool({
          name: 'analytics_create_tracker',
          arguments: { name: 'Marketing site' },
        });
        const tracker = firstJson(trackerRes as never) as {
          id: string;
          identityVerificationSecret: string;
        };
        expect(tracker.identityVerificationSecret.length).toBeGreaterThan(0);

        const config = firstJson(
          (await c.callTool({ name: 'analytics_export_config', arguments: {} })) as never,
        ) as ConfigExport;

        const firstPage = firstJson(
          (await c.callTool({
            name: 'analytics_export_events',
            arguments: { limit: 2 },
          })) as never,
        ) as EventsPage;

        const allViews: Array<{ id: string; subjectId: string }> = [];
        const allSearches: Array<{ id: string; query: string }> = [];
        let page = firstPage;
        for (;;) {
          allViews.push(...page.records.viewEvents);
          allSearches.push(...page.records.searchEvents);
          if (!page.nextCursor) break;
          page = firstJson(
            (await c.callTool({
              name: 'analytics_export_events',
              arguments: { limit: 2, cursor: page.nextCursor },
            })) as never,
          ) as EventsPage;
        }
        return { config, firstPage, allViews, allSearches };
      });

      expect(seeded.config.trackers.length).toBe(1);
      expect(seeded.config.trackers[0]!.identityVerificationSecret).toBe('__redacted__');
      expect(seeded.firstPage.nextCursor).not.toBeNull();
      expect(seeded.allViews.length).toBe(4);
      expect(seeded.allSearches.length).toBe(1);

      const srcTrackerId = seeded.config.trackers[0]!.id;
      const srcViewIds = seeded.allViews.map((v) => v.id);
      const srcSearchId = seeded.allSearches[0]!.id;

      const firstImport = await withClient(adminKeyB, async (c) => {
        const res = await c.callTool({
          name: 'analytics_import',
          arguments: {
            config: seeded.config,
            events: { viewEvents: seeded.allViews, searchEvents: seeded.allSearches },
          },
        });
        return firstJson(res as never) as ImportResult;
      });

      expect(firstImport.created).toBe(1 + 4 + 1);
      expect(firstImport.idMap[srcTrackerId]).toMatch(/^atr_/);
      expect(firstImport.idMap[srcTrackerId]).not.toBe(srcTrackerId);
      for (const id of srcViewIds) expect(firstImport.idMap[id]).toMatch(/^avw_/);
      expect(firstImport.idMap[srcSearchId]).toMatch(/^asr_/);
      expect(firstImport.warnings.some((w) => w.includes('identity-verification'))).toBe(true);

      const secondImport = await withClient(adminKeyB, async (c) => {
        const res = await c.callTool({
          name: 'analytics_import',
          arguments: { config: seeded.config },
        });
        return firstJson(res as never) as ImportResult;
      });
      expect(secondImport.created).toBe(0);
      expect(secondImport.skipped).toBe(1);
    });
  },
);
