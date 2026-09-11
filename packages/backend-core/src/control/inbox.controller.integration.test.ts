import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { randomToken } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { eq, sql } from 'drizzle-orm';
import { createApp } from '../bootstrap-app.ts';
import { AppModule } from '../app.module.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run inbox controller tests.';

const FLAGGED_COUNT = 57;
const LIVE_LIST_LIMIT = 50;

interface InboxResponse {
  live: Array<{ id: string }>;
  liveTotal: number;
}

(skipReason ? describe.skip : describe)('GET /v1/inbox live count', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let userId: string;
  let sessionToken: string;
  let channelId: string;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
    process.env.MUNIN_CMS_SCHEDULE_WORKER_DISABLED = '1';
    process.env.MUNIN_STORAGE_PROVIDER = 'local';

    await runMigrations(TEST_URL!);

    const appUrl = TEST_URL!.replace(
      /(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/,
      '$1munin_app:munin_app@',
    );
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const label = `inbox-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const [org] = await db.insert(schema.orgs).values({ name: `Org ${label}` }).returning();
    orgId = org!.id;

    const [user] = await db
      .insert(schema.users)
      .values({ email: `${label}@example.com`, name: 'Owner User' })
      .returning();
    userId = user!.id;
    await db
      .insert(schema.orgMembers)
      .values({ orgId, userId, role: 'owner', isDefault: true });

    sessionToken = randomToken(32);
    await db.insert(schema.sessions).values({
      userId,
      token: sessionToken,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const [channel] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'chat', vendor: 'munin', name: `${label}-channel` })
      .returning();
    channelId = channel!.id;

    await db.insert(schema.convConversations).values(
      Array.from({ length: FLAGGED_COUNT }, (_, i) => ({
        orgId,
        displayId: i + 1,
        channelId,
        status: 'open',
        needsHumanAttention: true,
        needsHumanAttentionAt: new Date(Date.now() - i * 60_000),
        lastMessageAt: new Date(Date.now() - i * 60_000),
      })),
    );

    app = await createApp(AppModule, { logger: false });
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
      if (orgId) await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId));
    }
  });

  async function fetchInbox(): Promise<InboxResponse> {
    const res = await fetch(`${baseUrl}/v1/inbox`, {
      headers: { Cookie: `better-auth.session_token=${sessionToken}.placeholder-sig` },
    });
    expect(res.status).toBe(200);
    return (await res.json()) as InboxResponse;
  }

  it('truncates the live list but reports every flagged conversation in liveTotal', async () => {
    const body = await fetchInbox();
    expect(body.live).toHaveLength(LIVE_LIST_LIMIT);
    expect(body.liveTotal).toBe(FLAGGED_COUNT);
  });

  it('counts a claimed conversation whose attention flag was cleared', async () => {
    const [taken] = await db
      .insert(schema.convConversations)
      .values({
        orgId,
        displayId: FLAGGED_COUNT + 1,
        channelId,
        status: 'open',
        needsHumanAttention: false,
        lastMessageAt: new Date(),
      })
      .returning();
    await db.insert(schema.claims).values({
      orgId,
      entityType: 'conversation',
      entityId: taken!.id,
      userId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const body = await fetchInbox();
    expect(body.liveTotal).toBe(FLAGGED_COUNT + 1);
    expect(body.live.some((c) => c.id === taken!.id)).toBe(true);
  });

  it('leaves closed and spam conversations out of the count', async () => {
    await db.insert(schema.convConversations).values([
      {
        orgId,
        displayId: FLAGGED_COUNT + 2,
        channelId,
        status: 'closed',
        needsHumanAttention: true,
        lastMessageAt: new Date(),
      },
      {
        orgId,
        displayId: FLAGGED_COUNT + 3,
        channelId,
        status: 'spam',
        needsHumanAttention: true,
        lastMessageAt: new Date(),
      },
    ]);

    const body = await fetchInbox();
    expect(body.liveTotal).toBe(FLAGGED_COUNT + 1);
  });
});
