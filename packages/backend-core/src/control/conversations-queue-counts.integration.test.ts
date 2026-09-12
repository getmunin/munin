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
  : 'Set TEST_DATABASE_URL to a Postgres URL to run conversation queue count tests.';

const OPEN_COUNT = 105;
const PAGE_LIMIT = 100;
const FLAGGED_INDEXES = [0, 100, 101, 102, 103, 104];

interface QueuePage {
  items: Array<{ id: string; needsHumanAttention: boolean }>;
  nextCursor: string | null;
}

interface QueueCounts {
  needsYou: number;
  inProgress: number;
  total: number;
}

(skipReason ? describe.skip : describe)('GET /v1/conversations/queue/counts', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let userId: string;
  let otherUserId: string;
  let sessionToken: string;
  let conversationIds: string[] = [];

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

    const label = `queue-counts-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
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

    const [other] = await db
      .insert(schema.users)
      .values({ email: `${label}-mate@example.com`, name: 'Teammate' })
      .returning();
    otherUserId = other!.id;
    await db.insert(schema.orgMembers).values({ orgId, userId: otherUserId, role: 'admin' });

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

    const rows = await db
      .insert(schema.convConversations)
      .values(
        Array.from({ length: OPEN_COUNT }, (_, i) => ({
          orgId,
          displayId: i + 1,
          channelId: channel!.id,
          status: 'open',
          needsHumanAttention: FLAGGED_INDEXES.includes(i),
          ...(FLAGGED_INDEXES.includes(i)
            ? { needsHumanAttentionAt: new Date(Date.now() - i * 60_000) }
            : {}),
          lastMessageAt: new Date(Date.now() - i * 60_000),
        })),
      )
      .returning();
    conversationIds = rows.map((r) => r.id);

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

  async function get<T>(path: string): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { Cookie: `better-auth.session_token=${sessionToken}.placeholder-sig` },
    });
    expect(res.status).toBe(200);
    return (await res.json()) as T;
  }

  const counts = () => get<QueueCounts>('/v1/conversations/queue/counts');

  it('counts flagged conversations the first page never reaches', async () => {
    const page = await get<QueuePage>(
      `/v1/conversations/queue?status=open&limit=${PAGE_LIMIT}`,
    );
    expect(page.items).toHaveLength(PAGE_LIMIT);
    expect(page.items.filter((i) => i.needsHumanAttention)).toHaveLength(1);

    const body = await counts();
    expect(body.total).toBe(OPEN_COUNT);
    expect(body.needsYou).toBe(FLAGGED_INDEXES.length);
    expect(body.inProgress).toBe(OPEN_COUNT - FLAGGED_INDEXES.length);
  });

  it('reaches the conversations past the first page through the cursor', async () => {
    const first = await get<QueuePage>(
      `/v1/conversations/queue?status=open&limit=${PAGE_LIMIT}`,
    );
    expect(first.nextCursor).not.toBeNull();
    const second = await get<QueuePage>(
      `/v1/conversations/queue?status=open&limit=${PAGE_LIMIT}&cursor=${encodeURIComponent(
        first.nextCursor!,
      )}`,
    );
    expect(second.items).toHaveLength(OPEN_COUNT - PAGE_LIMIT);
    expect(second.items.filter((i) => i.needsHumanAttention)).toHaveLength(
      FLAGGED_INDEXES.length - 1,
    );
    expect(second.nextCursor).toBeNull();
  });

  it('moves a conversation the viewer claimed into needsYou and one a teammate claimed out of it', async () => {
    const before = await counts();

    await db.insert(schema.claims).values({
      orgId,
      entityType: 'conversation',
      entityId: conversationIds[5]!,
      userId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const mine = await counts();
    expect(mine.needsYou).toBe(before.needsYou + 1);
    expect(mine.inProgress).toBe(before.inProgress - 1);

    await db.insert(schema.claims).values({
      orgId,
      entityType: 'conversation',
      entityId: conversationIds[104]!,
      userId: otherUserId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const theirs = await counts();
    expect(theirs.needsYou).toBe(before.needsYou);
    expect(theirs.inProgress).toBe(before.inProgress);
    expect(theirs.total).toBe(before.total);
  });

  it('ignores an expired claim', async () => {
    await db.insert(schema.claims).values({
      orgId,
      entityType: 'conversation',
      entityId: conversationIds[100]!,
      userId: otherUserId,
      expiresAt: new Date(Date.now() - 60_000),
    });

    const body = await counts();
    expect(body.needsYou).toBe(FLAGGED_INDEXES.length);
  });

  it('leaves closed conversations out of the open queue counts', async () => {
    await db
      .update(schema.convConversations)
      .set({ status: 'closed' })
      .where(eq(schema.convConversations.id, conversationIds[1]!));

    const body = await counts();
    expect(body.total).toBe(OPEN_COUNT - 1);
    expect(body.inProgress).toBe(OPEN_COUNT - 1 - body.needsYou);
  });
});
