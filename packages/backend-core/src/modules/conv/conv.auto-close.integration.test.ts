import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { ActorIdentity, RequestContextStore, type RequestContext } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../app.module.ts';
import { ConvService } from './conv.service.ts';
import { reopenClosedConversation } from './conversation-reopen.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to run conv auto-close integration tests.';

const DAY_MS = 24 * 60 * 60 * 1000;

(skipReason ? describe.skip : describe)('conv auto-close sweep', () => {
  let app: INestApplication;
  let db: ReturnType<typeof createDb>;
  let conv: ConvService;
  let orgId: string;
  let chatChannelId: string;
  let voiceChannelId: string;
  let euId: string;
  let contactId: string;
  let displayCounter = 0;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
    process.env.MUNIN_BUILTIN_AGENT = '0';

    await runMigrations(TEST_URL!);

    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const [org] = await db.insert(schema.orgs).values({ name: 'Auto Close Org' }).returning();
    orgId = org!.id;

    const [chat] = await db
      .insert(schema.convChannels)
      .values({
        orgId,
        type: 'chat',
        vendor: 'munin',
        name: 'ac-chat',
        config: { provider: 'widget', originAllowlist: [] },
      })
      .returning();
    chatChannelId = chat!.id;

    const [voice] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'voice', vendor: 'vapi', name: 'ac-voice', config: {} })
      .returning();
    voiceChannelId = voice!.id;

    const [eu] = await db
      .insert(schema.endUsers)
      .values({ orgId, externalId: 'ac-eu', name: 'EU' })
      .returning();
    euId = eu!.id;

    const [contact] = await db
      .insert(schema.convContacts)
      .values({ orgId, endUserId: euId, name: 'EU' })
      .returning();
    contactId = contact!.id;

    app = await NestFactory.create(AppModule, { logger: false });
    await app.init();
    conv = app.get(ConvService);
  });

  afterAll(async () => {
    await app?.close();
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  async function runInOrg<T>(fn: () => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
      await tx.execute(sql`SELECT set_config('app.end_user_id', '', true)`);
      const actor = new ActorIdentity('admin_agent', 'auto-close-test', orgId, ['*'], ['admin']);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      return RequestContextStore.run(ctx, fn);
    });
  }

  async function mkConv(opts: {
    channelId?: string;
    status?: 'open' | 'snoozed' | 'closed' | 'spam';
    needsHumanAttention?: boolean;
    endUserId?: string | null;
    ageDays: number;
    messages: Array<{
      authorType: 'user' | 'agent' | 'end_user' | 'system';
      internal?: boolean;
      offsetMs: number;
    }>;
  }): Promise<string> {
    displayCounter += 1;
    const base = Date.now() - opts.ageDays * DAY_MS;
    const [c] = await db
      .insert(schema.convConversations)
      .values({
        orgId,
        channelId: opts.channelId ?? chatChannelId,
        endUserId: opts.endUserId === undefined ? euId : opts.endUserId,
        contactId,
        displayId: displayCounter,
        status: opts.status ?? 'open',
        needsHumanAttention: opts.needsHumanAttention ?? false,
        lastMessageAt: new Date(base),
      })
      .returning();
    for (const m of opts.messages) {
      await db.insert(schema.convMessages).values({
        orgId,
        conversationId: c!.id,
        authorType: m.authorType,
        authorId: 'author',
        body: 'x',
        internal: m.internal ?? false,
        createdAt: new Date(base + m.offsetMs),
      });
    }
    return c!.id;
  }

  async function awaitingIds(): Promise<string[]> {
    const rows = await runInOrg(() => conv.listConversationsAwaitingUserReply());
    return rows.map((r) => r.id);
  }

  it('includes a conversation we (AI agent) replied to last, idle past the threshold', async () => {
    const id = await mkConv({
      ageDays: 3,
      messages: [
        { authorType: 'end_user', offsetMs: 0 },
        { authorType: 'agent', offsetMs: 1000 },
      ],
    });
    expect(await awaitingIds()).toContain(id);
  });

  it('includes a conversation a human teammate replied to last', async () => {
    const id = await mkConv({
      ageDays: 3,
      messages: [
        { authorType: 'end_user', offsetMs: 0 },
        { authorType: 'user', offsetMs: 1000 },
      ],
    });
    expect(await awaitingIds()).toContain(id);
  });

  it('excludes a conversation where the end-user spoke last', async () => {
    const id = await mkConv({
      ageDays: 3,
      messages: [
        { authorType: 'agent', offsetMs: 0 },
        { authorType: 'end_user', offsetMs: 1000 },
      ],
    });
    expect(await awaitingIds()).not.toContain(id);
  });

  it('ignores internal notes when deciding who spoke last', async () => {
    const id = await mkConv({
      ageDays: 3,
      messages: [
        { authorType: 'agent', offsetMs: 0 },
        { authorType: 'agent', internal: true, offsetMs: 1000 },
      ],
    });
    expect(await awaitingIds()).toContain(id);
  });

  it('excludes conversations still within the threshold', async () => {
    const id = await mkConv({
      ageDays: 0,
      messages: [{ authorType: 'agent', offsetMs: 0 }],
    });
    expect(await awaitingIds()).not.toContain(id);
  });

  it('excludes snoozed and closed conversations', async () => {
    const snoozed = await mkConv({
      status: 'snoozed',
      ageDays: 3,
      messages: [{ authorType: 'agent', offsetMs: 0 }],
    });
    const closed = await mkConv({
      status: 'closed',
      ageDays: 3,
      messages: [{ authorType: 'agent', offsetMs: 0 }],
    });
    const ids = await awaitingIds();
    expect(ids).not.toContain(snoozed);
    expect(ids).not.toContain(closed);
  });

  it('excludes voice conversations', async () => {
    const id = await mkConv({
      channelId: voiceChannelId,
      ageDays: 3,
      messages: [{ authorType: 'agent', offsetMs: 0 }],
    });
    expect(await awaitingIds()).not.toContain(id);
  });

  it('excludes conversations flagged as needing human attention', async () => {
    const id = await mkConv({
      needsHumanAttention: true,
      ageDays: 3,
      messages: [{ authorType: 'agent', offsetMs: 0 }],
    });
    expect(await awaitingIds()).not.toContain(id);
  });

  it('closes qualifying conversations and enqueues CRM extraction', async () => {
    const id = await mkConv({
      ageDays: 3,
      messages: [
        { authorType: 'end_user', offsetMs: 0 },
        { authorType: 'agent', offsetMs: 1000 },
      ],
    });
    const closedCount = await runInOrg(() => conv.autoCloseInactive());
    expect(closedCount).toBeGreaterThanOrEqual(1);

    const [row] = await db
      .select({ status: schema.convConversations.status })
      .from(schema.convConversations)
      .where(sql`id = ${id}`);
    expect(row!.status).toBe('closed');

    const jobs = await db
      .select({ id: schema.curatorJobs.id })
      .from(schema.curatorJobs)
      .where(sql`dedupe_key = ${`crm-contact-extract:conv:${id}`}`);
    expect(jobs.length).toBe(1);
  });

  it('reopenClosedConversation flips closed/snoozed to open exactly once', async () => {
    const id = await mkConv({
      status: 'closed',
      ageDays: 0,
      messages: [{ authorType: 'agent', offsetMs: 0 }],
    });
    expect(await reopenClosedConversation(db, id)).toBe(true);

    const [row] = await db
      .select({ status: schema.convConversations.status })
      .from(schema.convConversations)
      .where(sql`id = ${id}`);
    expect(row!.status).toBe('open');

    expect(await reopenClosedConversation(db, id)).toBe(false);
  });
});
