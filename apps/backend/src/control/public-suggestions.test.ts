import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { createDb, runMigrations, schema } from '@munin/db';
import { sql } from 'drizzle-orm';
import { AppModule } from '../app.module.js';

const TEST_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set DATABASE_URL or TEST_DATABASE_URL to a Postgres URL to run public-suggestions tests.';

(skipReason ? describe.skip : describe)('GET /api/public/suggestions', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgAId: string;
  let orgBId: string;

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

    const ts = Date.now();
    const [orgA] = await db
      .insert(schema.orgs)
      .values({ name: 'Pub Test A', slug: `pub-a-${ts}` })
      .returning();
    const [orgB] = await db
      .insert(schema.orgs)
      .values({ name: 'Pub Test B', slug: `pub-b-${ts}` })
      .returning();
    orgAId = orgA!.id;
    orgBId = orgB!.id;

    // Two published suggestions across both orgs + one private to orgA.
    await db.insert(schema.suggestions).values([
      {
        orgId: orgAId,
        title: 'Voted-A1',
        body: 'Public from A',
        status: 'open',
        createdByType: 'user',
        createdById: 'usr_a',
        public: true,
        voteCount: 12,
      },
      {
        orgId: orgBId,
        title: 'Voted-B1',
        body: 'Public from B',
        status: 'open',
        createdByType: 'user',
        createdById: 'usr_b',
        public: true,
        voteCount: 5,
      },
      {
        orgId: orgAId,
        title: 'Private-A2',
        body: 'Org-private — must not appear publicly',
        status: 'open',
        createdByType: 'user',
        createdById: 'usr_a',
        public: false,
        voteCount: 99,
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
      await db.delete(schema.orgs).where(sql`id IN (${orgAId}, ${orgBId})`);
    }
  });

  it('returns published suggestions across orgs, hides private ones, ranks by votes', async () => {
    const res = await fetch(`${baseUrl}/api/public/suggestions`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      title: string;
      voteCount: number;
    }>;
    const titles = body.map((b) => b.title);
    expect(titles).toContain('Voted-A1');
    expect(titles).toContain('Voted-B1');
    expect(titles).not.toContain('Private-A2');

    const a = body.findIndex((b) => b.title === 'Voted-A1');
    const bIdx = body.findIndex((b) => b.title === 'Voted-B1');
    expect(a).toBeLessThan(bIdx); // A has 12 votes, B has 5
  });

  it('does not require auth — anonymous fetch works', async () => {
    const res = await fetch(`${baseUrl}/api/public/suggestions?limit=5`);
    expect(res.status).toBe(200);
  });
});
