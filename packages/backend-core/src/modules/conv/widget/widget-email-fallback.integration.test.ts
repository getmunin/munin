import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { StubMailer } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql, eq } from 'drizzle-orm';
import { AppModule } from '../../../app.module.js';
import { MAILER } from '../../../common/mail/mail.module.js';
import { WidgetEmailFallbackWorker } from './widget-email-fallback.worker.js';

const TEST_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set DATABASE_URL or TEST_DATABASE_URL to a Postgres URL to run widget fallback integration tests.';

const REPLY_DOMAIN = 'reply.example.test';

(skipReason ? describe.skip : describe)('Widget → email fallback worker', () => {
  let app: INestApplication;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let widgetChannelId: string;
  let emailChannelId: string;
  let endUserId: string;
  let contactId: string;
  let worker: WidgetEmailFallbackWorker;
  let mailer: StubMailer;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_ENCRYPTION_KEY ??= 'integration-test-encryption-key';
    process.env.MUNIN_EMAIL_REPLY_DOMAIN = REPLY_DOMAIN;
    process.env.MUNIN_WIDGET_EMAIL_FALLBACK_THRESHOLD_MS = '0';

    await runMigrations(TEST_URL!);

    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const ts = Date.now();
    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'Fallback IT', slug: `wfb-it-${ts}` })
      .returning();
    orgId = org!.id;

    const [widget] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'chat', name: 'Widget', active: true, config: {} })
      .returning();
    widgetChannelId = widget!.id;

    const [email] = await db
      .insert(schema.convChannels)
      .values({
        orgId,
        type: 'email',
        name: 'Acme Support',
        active: true,
        config: {
          addressing: { fromAddress: 'support@acme.test', fromName: 'Acme Support' },
          outbound: { provider: 'mailer' },
        },
      })
      .returning();
    emailChannelId = email!.id;

    const [eu] = await db
      .insert(schema.endUsers)
      .values({ orgId, email: 'visitor@customer.test', name: 'Visitor One' })
      .returning();
    endUserId = eu!.id;

    const [c] = await db
      .insert(schema.convContacts)
      .values({ orgId, endUserId, email: 'visitor@customer.test', name: 'Visitor One' })
      .returning();
    contactId = c!.id;

    app = await NestFactory.create(AppModule, { logger: false });
    await app.init();

    worker = app.get(WidgetEmailFallbackWorker);
    mailer = app.get<StubMailer>(MAILER);
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  beforeEach(async () => {
    mailer.clear();
    await db.delete(schema.convWidgetEmailFallbacks).where(eq(schema.convWidgetEmailFallbacks.orgId, orgId));
    await db.delete(schema.convMessageDeliveries).where(eq(schema.convMessageDeliveries.orgId, orgId));
    await db.delete(schema.convMessageReads).where(eq(schema.convMessageReads.orgId, orgId));
    await db.delete(schema.convMessages).where(eq(schema.convMessages.orgId, orgId));
    await db.delete(schema.convConversations).where(eq(schema.convConversations.orgId, orgId));
  });

  async function newConv(subject = 'Hello'): Promise<string> {
    const rows = await db.execute<{ next: number } & Record<string, unknown>>(
      sql`SELECT conv_next_display_id(${orgId}) AS next`,
    );
    const list = Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? []);
    const displayId = (list[0] as { next: number }).next;
    const [conv] = await db
      .insert(schema.convConversations)
      .values({
        orgId,
        channelId: widgetChannelId,
        contactId,
        endUserId,
        displayId,
        subject,
        lastMessageAt: new Date(),
      })
      .returning();
    return conv!.id;
  }

  async function insertMsg(
    convId: string,
    authorType: 'end_user' | 'agent',
    body: string,
    ageMs = 30_000,
  ): Promise<string> {
    const createdAt = new Date(Date.now() - ageMs);
    const [m] = await db
      .insert(schema.convMessages)
      .values({
        orgId,
        conversationId: convId,
        authorType,
        authorId: authorType === 'end_user' ? contactId : 'system',
        body,
        createdAt,
      })
      .returning();
    return m!.id;
  }

  it('sends a digest when an agent message is unread and writes a delivery row for threading', async () => {
    const convId = await newConv('Login help');
    await insertMsg(convId, 'end_user', 'Hi, I need help.', 60_000);
    const agentMsgId = await insertMsg(convId, 'agent', 'Sure — what are you stuck on?', 30_000);

    const result = await worker.tick();
    expect(result.sent).toBe(1);

    expect(mailer.outbox).toHaveLength(1);
    const sent = mailer.outbox[0]!;
    expect(sent.to).toBe('visitor@customer.test');
    expect(sent.from).toContain('support@acme.test');
    expect(sent.text).toContain('Sure — what are you stuck on?');
    expect(sent.replyTo).toBe(`support+conv-${convId}@${REPLY_DOMAIN}`);
    const stamped = sent.headers?.['Message-ID'];
    expect(stamped).toMatch(/^<[^<>]+@acme\.test>$/);

    const fallbacks = await db
      .select()
      .from(schema.convWidgetEmailFallbacks)
      .where(eq(schema.convWidgetEmailFallbacks.conversationId, convId));
    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0]!.status).toBe('sent');
    expect(fallbacks[0]!.messageIdHeader).toBeTruthy();
    expect(fallbacks[0]!.triggerMessageId).toBe(agentMsgId);
    expect(fallbacks[0]!.messageCount).toBe(1);

    const deliveries = await db
      .select()
      .from(schema.convMessageDeliveries)
      .where(eq(schema.convMessageDeliveries.messageId, agentMsgId));
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.channelId).toBe(emailChannelId);
    expect(deliveries[0]!.status).toBe('sent');
    expect(deliveries[0]!.messageIdHeader).toBe(fallbacks[0]!.messageIdHeader);
  });

  it('bundles multiple unread agent messages into one digest with N delivery rows', async () => {
    const convId = await newConv();
    await insertMsg(convId, 'end_user', 'Hi.', 90_000);
    const m1 = await insertMsg(convId, 'agent', 'First reply.', 60_000);
    const m2 = await insertMsg(convId, 'agent', 'And a follow-up.', 30_000);

    const result = await worker.tick();
    expect(result.sent).toBe(1);

    expect(mailer.outbox).toHaveLength(1);
    expect(mailer.outbox[0]!.text).toContain('First reply.');
    expect(mailer.outbox[0]!.text).toContain('And a follow-up.');

    const fb = (
      await db.select().from(schema.convWidgetEmailFallbacks).where(eq(schema.convWidgetEmailFallbacks.conversationId, convId))
    )[0]!;
    expect(fb.messageCount).toBe(2);

    const deliveries = await db
      .select()
      .from(schema.convMessageDeliveries)
      .where(eq(schema.convMessageDeliveries.channelId, emailChannelId));
    expect(deliveries.map((d) => d.messageId).sort()).toEqual([m1, m2].sort());
  });

  it('does not fire a second time in the same quiet period', async () => {
    const convId = await newConv();
    await insertMsg(convId, 'end_user', 'Hi.', 90_000);
    await insertMsg(convId, 'agent', 'Reply.', 30_000);

    const r1 = await worker.tick();
    expect(r1.sent).toBe(1);
    const r2 = await worker.tick();
    expect(r2.sent).toBe(0);
    expect(mailer.outbox).toHaveLength(1);
  });

  it('does not fire when the end-user has already read the agent message', async () => {
    const convId = await newConv();
    await insertMsg(convId, 'end_user', 'Hi.', 90_000);
    const agentMsgId = await insertMsg(convId, 'agent', 'Reply.', 30_000);

    await db.insert(schema.convMessageReads).values({
      orgId,
      conversationId: convId,
      messageId: agentMsgId,
      endUserId,
    });

    const r = await worker.tick();
    expect(r.sent).toBe(0);
    expect(mailer.outbox).toHaveLength(0);
  });

  it('fires again once the end-user engages (resetting the quiet period)', async () => {
    const convId = await newConv();
    await insertMsg(convId, 'end_user', 'Hi.', 120_000);
    await insertMsg(convId, 'agent', 'First reply.', 60_000);

    const r1 = await worker.tick();
    expect(r1.sent).toBe(1);

    await insertMsg(convId, 'end_user', 'Sorry — back now. Still stuck.', 0);
    await insertMsg(convId, 'agent', 'No worries — try X.', 0);

    const r2 = await worker.tick();
    expect(r2.sent).toBe(1);
    expect(mailer.outbox).toHaveLength(2);
  });
});
