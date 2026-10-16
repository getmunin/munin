import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { ActorIdentity, RequestContextStore, type RequestContext } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../app.module.ts';
import { ConvService } from './conv.service.ts';
import { WidgetIngestService } from './widget/widget-ingest.service.ts';
import { WidgetIngestInput } from './widget/widget.types.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to run unengaged widget conversation integration tests.';

const HOUR_MS = 60 * 60 * 1000;

(skipReason ? describe.skip : describe)('unengaged widget conversations', () => {
  let app: INestApplication;
  let db: ReturnType<typeof createDb>;
  let conv: ConvService;
  let widget: WidgetIngestService;
  let orgId: string;
  let channelId: string;

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

    const [org] = await db.insert(schema.orgs).values({ name: 'Unengaged Org' }).returning();
    orgId = org!.id;

    const [chat] = await db
      .insert(schema.convChannels)
      .values({
        orgId,
        type: 'chat',
        vendor: 'munin',
        name: 'unengaged-chat',
        config: { provider: 'widget', originAllowlist: [] },
      })
      .returning();
    channelId = chat!.id;

    app = await NestFactory.create(AppModule, { logger: false });
    await app.init();
    conv = app.get(ConvService);
    widget = app.get(WidgetIngestService);
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
      const actor = new ActorIdentity('admin_agent', 'unengaged-test', orgId, ['*'], ['admin']);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      return RequestContextStore.run(ctx, fn);
    });
  }

  async function openWidget(): Promise<string> {
    const { conversationId } = await runInOrg(() =>
      widget.startConversation(orgId, { channelId, sessionId: `sess_${randomUUID()}` }),
    );
    return conversationId;
  }

  async function sessionOf(conversationId: string): Promise<string> {
    const [row] = await db
      .select({ metadata: schema.convConversations.metadata })
      .from(schema.convConversations)
      .where(eq(schema.convConversations.id, conversationId));
    return row!.metadata.sessionId as string;
  }

  async function isUnengaged(conversationId: string): Promise<boolean | undefined> {
    const [row] = await db
      .select({ unengaged: schema.convConversations.unengaged })
      .from(schema.convConversations)
      .where(eq(schema.convConversations.id, conversationId));
    return row?.unengaged;
  }

  async function idleFor(conversationId: string, hours: number): Promise<void> {
    await db
      .update(schema.convConversations)
      .set({ lastMessageAt: new Date(Date.now() - hours * HOUR_MS) })
      .where(eq(schema.convConversations.id, conversationId));
  }

  async function listedIds(): Promise<string[]> {
    const rows = await runInOrg(() => conv.listConversations({ status: 'open', limit: 200 }));
    return rows.map((r) => r.id);
  }

  it('opens the widget conversation unengaged and keeps it out of lists and counts', async () => {
    const before = await runInOrg(() => conv.countConversations({}));
    const sectionsBefore = await runInOrg(() => conv.countConversationQueueSections());
    const id = await openWidget();

    expect(await isUnengaged(id)).toBe(true);
    expect(await listedIds()).not.toContain(id);
    expect(await runInOrg(() => conv.countConversations({}))).toBe(before);
    expect((await runInOrg(() => conv.countConversationQueueSections())).total).toBe(
      sectionsBefore.total,
    );
    const page = await runInOrg(() => conv.listConversationQueuePage({ status: 'open' }));
    expect(page.items.map((i) => i.id)).not.toContain(id);
  });

  it('engages the conversation on the first visitor message', async () => {
    const id = await openWidget();
    const sessionId = await sessionOf(id);

    await runInOrg(() =>
      widget.ingest(
        orgId,
        WidgetIngestInput.parse({
          channelId,
          sessionId,
          messages: [{ role: 'end_user', body: 'Do you ship to Bergen?' }],
        }),
      ),
    );

    expect(await isUnengaged(id)).toBe(false);
    expect(await listedIds()).toContain(id);
  });

  it('engages the conversation when a teammate writes in it', async () => {
    const id = await openWidget();

    await runInOrg(() =>
      conv.sendMessage({
        conversationId: id,
        body: 'Anything I can help with?',
        authorType: 'user',
        authorId: 'usr_teammate',
        claim: false,
      }),
    );

    expect(await isUnengaged(id)).toBe(false);
  });

  it('stays unengaged through agent messages', async () => {
    const id = await openWidget();

    await runInOrg(() =>
      conv.sendMessage({
        conversationId: id,
        body: 'Hi! How can I help?',
        authorType: 'agent',
        authorId: 'agent',
      }),
    );

    expect(await isUnengaged(id)).toBe(true);
  });

  it('leaves unengaged conversations to the cleanup sweep instead of auto-closing them', async () => {
    const id = await openWidget();
    await db.insert(schema.convMessages).values({
      orgId,
      conversationId: id,
      authorType: 'agent',
      authorId: 'agent',
      body: 'Hi! How can I help?',
    });
    await idleFor(id, 72);

    const awaiting = await runInOrg(() => conv.listConversationsAwaitingUserReply());
    expect(awaiting.map((r) => r.id)).not.toContain(id);
  });

  it('deletes idle unengaged conversations and nothing else', async () => {
    const idle = await openWidget();
    await idleFor(idle, 25);
    const recent = await openWidget();
    await idleFor(recent, 2);
    const engaged = await openWidget();
    await db
      .update(schema.convConversations)
      .set({ unengaged: false })
      .where(eq(schema.convConversations.id, engaged));
    await idleFor(engaged, 25);
    const withUpload = await openWidget();
    await idleFor(withUpload, 25);
    await db.insert(schema.convAttachments).values({
      orgId,
      conversationId: withUpload,
      name: 'receipt.pdf',
      mime: 'application/pdf',
      storageProvider: 'local',
      createdByType: 'end_user',
      createdById: 'visitor',
    });

    const deleted = await runInOrg(() => conv.deleteUnengagedConversations());

    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(await isUnengaged(idle)).toBeUndefined();
    expect(await isUnengaged(recent)).toBe(true);
    expect(await isUnengaged(engaged)).toBe(false);
    expect(await isUnengaged(withUpload)).toBe(true);
  });

  it('starts a fresh conversation when a visitor returns to a session whose conversation was swept', async () => {
    const id = await openWidget();
    const sessionId = await sessionOf(id);
    await idleFor(id, 25);
    await runInOrg(() => conv.deleteUnengagedConversations());

    const result = await runInOrg(() =>
      widget.ingest(
        orgId,
        WidgetIngestInput.parse({
          channelId,
          sessionId,
          messages: [{ role: 'end_user', body: 'Back again' }],
        }),
      ),
    );

    expect(result.conversationId).not.toBe(id);
    expect(await isUnengaged(result.conversationId)).toBe(false);
  });
});
