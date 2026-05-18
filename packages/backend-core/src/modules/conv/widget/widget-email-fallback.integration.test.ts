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
      .values({ orgId, type: 'chat', vendor: 'munin', name: 'Widget', active: true, config: {} })
      .returning();
    widgetChannelId = widget!.id;

    const [email] = await db
      .insert(schema.convChannels)
      .values({
        orgId,
        type: 'email',
        vendor: 'mailer',
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
    authorType: 'end_user' | 'agent' | 'user',
    body: string,
    ageMs = 30_000,
    authorIdOverride?: string,
  ): Promise<string> {
    const createdAt = new Date(Date.now() - ageMs);
    const fallbackAuthorId =
      authorType === 'end_user' ? contactId : authorType === 'user' ? 'system' : 'system';
    const [m] = await db
      .insert(schema.convMessages)
      .values({
        orgId,
        conversationId: convId,
        authorType,
        authorId: authorIdOverride ?? fallbackAuthorId,
        body,
        createdAt,
      })
      .returning();
    return m!.id;
  }

  it('sends the latest unread agent message with quoted history, signoff, and no digest framing', async () => {
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

    const body = sent.text!;
    expect(body).not.toMatch(/^Hi,/m);
    expect(body).not.toContain('sent you');
    expect(body).not.toContain('Reply to this email');
    expect(body).not.toContain('Best regards,');
    // No assistants row for this org → agent signoff falls back to the channel fromName.
    expect(body).toContain('— Acme Support');
    expect(body).toContain('> Hi, I need help.');
    expect(body.indexOf('— Acme Support')).toBeGreaterThan(body.indexOf('Sure — what are you stuck on?'));
    expect(body.indexOf('— Acme Support')).toBeLessThan(body.indexOf('> Hi, I need help.'));
    expect(sent.subject).toBe('Login help');

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

  it('emails only the latest of multiple unread agent messages, quoting earlier ones, with N delivery rows', async () => {
    const convId = await newConv();
    await insertMsg(convId, 'end_user', 'Hi.', 90_000);
    const m1 = await insertMsg(convId, 'agent', 'First reply.', 60_000);
    const m2 = await insertMsg(convId, 'agent', 'And a follow-up.', 30_000);

    const result = await worker.tick();
    expect(result.sent).toBe(1);

    expect(mailer.outbox).toHaveLength(1);
    const body = mailer.outbox[0]!.text!;
    expect(body).toContain('And a follow-up.');
    expect(body).toContain('> First reply.');
    expect(body.indexOf('And a follow-up.')).toBeLessThan(body.indexOf('> First reply.'));

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

  it('does not re-email an already-delivered agent message even if it stays unread', async () => {
    const convId = await newConv();
    await insertMsg(convId, 'end_user', 'Hi.', 90_000);
    await insertMsg(convId, 'agent', 'Old agent reply.', 60_000);

    const r1 = await worker.tick();
    expect(r1.sent).toBe(1);
    expect(mailer.outbox[0]!.text!).toContain('Old agent reply.');

    // Engage via a new end-user message (resetting the quiet period) and
    // an agent reply. The old reply remains unread server-side. The
    // end-user message must be later than `conv_created_at` so r2's
    // engagement timestamp differs from r1's (otherwise the unique
    // `(conversation_id, last_engagement_at)` constraint blocks the
    // second fallback row). The agent message gets a small age so its
    // `created_at` lands reliably before `tick`'s cutoff.
    await insertMsg(convId, 'end_user', 'Followup question.', 0);
    await insertMsg(convId, 'agent', 'Fresh agent reply.', 50);

    const r2 = await worker.tick();
    expect(r2.sent).toBe(1);
    expect(mailer.outbox).toHaveLength(2);

    const secondBody = mailer.outbox[1]!.text!;
    const beforeSignoff = secondBody.split('\n— ')[0]!;
    expect(beforeSignoff).toContain('Fresh agent reply.');
    expect(beforeSignoff).not.toContain('Old agent reply.');
  });

  it('signs off with the assistants.name when the latest unread is from the AI', async () => {
    await db
      .insert(schema.assistants)
      .values({ orgId, name: 'Jens' })
      .onConflictDoUpdate({ target: schema.assistants.orgId, set: { name: 'Jens', updatedAt: new Date() } });

    const convId = await newConv('Login help');
    await insertMsg(convId, 'end_user', 'Hi.', 90_000);
    await insertMsg(convId, 'agent', 'Sure — what are you stuck on?', 30_000);

    const result = await worker.tick();
    expect(result.sent).toBe(1);
    const body = mailer.outbox[0]!.text!;
    expect(body).toContain('— Jens');
    expect(body).not.toContain('— Acme Support');

    await db.delete(schema.assistants).where(eq(schema.assistants.orgId, orgId));
  });

  it('signs off with the human operator first name when the latest unread is from a human', async () => {
    const [op] = await db
      .insert(schema.users)
      .values({ email: `op-${Date.now()}@example.test`, name: 'Maja Hansen' })
      .returning();
    const opId = op!.id;

    const convId = await newConv('Login help');
    await insertMsg(convId, 'end_user', 'Hi.', 90_000);
    await insertMsg(convId, 'user', 'Hi — Maja here, let me look.', 30_000, opId);

    const result = await worker.tick();
    expect(result.sent).toBe(1);
    const body = mailer.outbox[0]!.text!;
    expect(body).toContain('— Maja');
    expect(body).not.toContain('— Maja Hansen');

    await db.delete(schema.users).where(eq(schema.users.id, opId));
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
