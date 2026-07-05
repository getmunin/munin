import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { WebhookDispatcher } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { ConvService } from '../conv/conv.service.ts';
import { ConversationClaimsService } from '../conv/conv.claims.service.ts';
import { AlertsService } from '../system-alerts/system-alerts.service.ts';
import { CuratorJobsService } from '../curator/curator-jobs.service.ts';
import type { SlackApiClient } from './slack-api.client.ts';
import { SlackEventSink } from './slack-event-sink.ts';
import { SlackInboundService } from './slack-inbound.service.ts';
import { SlackBridgeWorker } from './slack-bridge.worker.ts';
import { encryptSecretValue } from './slack.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run slack inbound tests.';

const THREAD_TS = '1750000000.000100';
const CHANNEL = 'C_INBOUND';

class FakeSlackApi {
  usersById = new Map<string, { email: string | null; isBot?: boolean }>();
  usersInfoCalls = 0;
  ephemerals: { channel: string; user: string; text: string }[] = [];
  posted: { channel: string; text: string; threadTs?: string; ts: string }[] = [];
  private counter = 0;

  usersInfo(input: { token: string; user: string }) {
    this.usersInfoCalls += 1;
    const entry = this.usersById.get(input.user);
    return Promise.resolve({
      id: input.user,
      email: entry?.email ?? null,
      displayName: 'Fake User',
      isBot: entry?.isBot === true,
    });
  }

  postEphemeral(input: { token: string; channel: string; user: string; text: string }) {
    this.ephemerals.push({ channel: input.channel, user: input.user, text: input.text });
    return Promise.resolve();
  }

  postMessage(input: { token: string; channel: string; text: string; threadTs?: string }) {
    this.counter += 1;
    const ts = `1750000001.${String(this.counter).padStart(6, '0')}`;
    this.posted.push({ channel: input.channel, text: input.text, threadTs: input.threadTs, ts });
    return Promise.resolve({ ts, channel: input.channel });
  }

  asClient(): SlackApiClient {
    return this as unknown as SlackApiClient;
  }
}

(skipReason ? describe.skip : describe)('Slack inbound (reply-from-thread)', () => {
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let memberUserId: string;
  let channelId: string;
  let conversationId: string;
  let integrationId: string;
  let api: FakeSlackApi;
  let inbound: SlackInboundService;
  let displayIdSeq = 0;

  beforeAll(async () => {
    process.env.MUNIN_ENCRYPTION_KEY ??= 'slack-inbound-test-encryption-key';
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });

    const ts = Date.now();
    const [org] = await db.insert(schema.orgs).values({ name: 'Slack Inbound Test Org' }).returning();
    orgId = org!.id;
    const [member] = await db
      .insert(schema.users)
      .values({ email: `slack-op-${ts}@example.com`, name: 'Olivia Operator' })
      .returning();
    memberUserId = member!.id;
    await db.insert(schema.orgMembers).values({ orgId, userId: memberUserId });

    const [channel] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'chat', vendor: 'widget', name: 'Website chat' })
      .returning();
    channelId = channel!.id;
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
      await db.delete(schema.users).where(eq(schema.users.id, memberUserId));
    }
  });

  beforeEach(async () => {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await db.delete(schema.slackIntegrations).where(eq(schema.slackIntegrations.orgId, orgId));
    await db.execute(sql`DELETE FROM claims WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM curator_jobs WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM conv_messages WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM conv_conversations WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM events WHERE org_id = ${orgId}`);

    const encryptedBotToken = await encryptSecretValue(db, 'xoxb-inbound-token');
    const [integration] = await db
      .insert(schema.slackIntegrations)
      .values({
        orgId,
        teamId: 'T_INBOUND',
        encryptedBotToken,
        botUserId: 'U_MUNIN_BOT',
      })
      .returning();
    integrationId = integration!.id;
    await db.insert(schema.slackChannelRoutes).values({
      orgId,
      integrationId,
      teamId: 'T_INBOUND',
      slackChannelId: CHANNEL,
      purpose: 'default',
    });

    displayIdSeq += 1;
    const [conversation] = await db
      .insert(schema.convConversations)
      .values({ orgId, displayId: displayIdSeq, channelId, subject: 'Widget question' })
      .returning();
    conversationId = conversation!.id;
    await db.insert(schema.slackConversationLinks).values({
      orgId,
      integrationId,
      conversationId,
      slackChannelId: CHANNEL,
      slackThreadTs: THREAD_TS,
    });

    api = new FakeSlackApi();
    const dispatcher = new WebhookDispatcher();
    dispatcher.registerSink(new SlackEventSink());
    const conv = new ConvService(
      dispatcher,
      new ConversationClaimsService(dispatcher),
      new CuratorJobsService(dispatcher),
      new AlertsService(dispatcher),
    );
    inbound = new SlackInboundService(db, api.asClient(), conv);
  });

  function replyPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      type: 'event_callback',
      event: {
        type: 'message',
        channel: CHANNEL,
        user: 'U_OPERATOR',
        text: 'Hello from Slack',
        ts: `1750000002.${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`,
        thread_ts: THREAD_TS,
        ...overrides,
      },
    };
  }

  async function messages() {
    return db
      .select()
      .from(schema.convMessages)
      .where(eq(schema.convMessages.conversationId, conversationId));
  }

  it('records a mapped thread reply as the org member and never re-mirrors it', async () => {
    api.usersById.set('U_OPERATOR', { email: `SLACK-OP@example.com` });
    const [member] = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, memberUserId));
    api.usersById.set('U_OPERATOR', { email: member!.email.toUpperCase() });

    await inbound.processEventCallback(replyPayload());

    const rows = await messages();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      authorType: 'user',
      authorId: memberUserId,
      body: 'Hello from Slack',
      internal: false,
    });

    const [messageLink] = await db
      .select()
      .from(schema.slackMessageLinks)
      .where(eq(schema.slackMessageLinks.messageId, rows[0]!.id));
    expect(messageLink?.origin).toBe('slack');

    const [userLink] = await db
      .select()
      .from(schema.slackUserLinks)
      .where(
        and(
          eq(schema.slackUserLinks.integrationId, integrationId),
          eq(schema.slackUserLinks.slackUserId, 'U_OPERATOR'),
        ),
      );
    expect(userLink?.userId).toBe(memberUserId);

    const worker = new SlackBridgeWorker(db, api.asClient());
    await worker.tick();
    const remirrored = api.posted.filter((p) => p.text.includes('Hello from Slack'));
    expect(remirrored).toHaveLength(0);
    expect(api.ephemerals).toHaveLength(0);
  });

  it('reuses the cached user link without calling users.info again', async () => {
    const [member] = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, memberUserId));
    api.usersById.set('U_OPERATOR', { email: member!.email });

    await inbound.processEventCallback(replyPayload());
    expect(api.usersInfoCalls).toBe(1);
    await inbound.processEventCallback(replyPayload({ text: 'Second reply' }));
    expect(api.usersInfoCalls).toBe(1);
    expect(await messages()).toHaveLength(2);
  });

  it('treats a leading ! as an internal note', async () => {
    const [member] = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, memberUserId));
    api.usersById.set('U_OPERATOR', { email: member!.email });

    await inbound.processEventCallback(replyPayload({ text: '!checking with billing' }));

    const rows = await messages();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ internal: true, body: 'checking with billing' });
  });

  it('rejects an unmapped slack user with an ephemeral notice and records nothing', async () => {
    api.usersById.set('U_OPERATOR', { email: 'stranger@example.com' });

    await inbound.processEventCallback(replyPayload());

    expect(await messages()).toHaveLength(0);
    expect(api.ephemerals).toHaveLength(1);
    expect(api.ephemerals[0]).toMatchObject({ channel: CHANNEL, user: 'U_OPERATOR' });
  });

  it('rejects a previously-mapped user whose org membership was revoked', async () => {
    await db.insert(schema.slackUserLinks).values({
      orgId,
      integrationId,
      slackUserId: 'U_FORMER',
      userId: memberUserId,
    });
    await db
      .delete(schema.orgMembers)
      .where(and(eq(schema.orgMembers.orgId, orgId), eq(schema.orgMembers.userId, memberUserId)));
    try {
      await inbound.processEventCallback(replyPayload({ user: 'U_FORMER' }));
      expect(await messages()).toHaveLength(0);
      expect(api.ephemerals).toHaveLength(1);
    } finally {
      await db.insert(schema.orgMembers).values({ orgId, userId: memberUserId });
    }
  });

  it('ignores bot messages, top-level messages, edits, and unknown threads', async () => {
    const [member] = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, memberUserId));
    api.usersById.set('U_OPERATOR', { email: member!.email });

    await inbound.processEventCallback(replyPayload({ bot_id: 'B123' }));
    await inbound.processEventCallback(replyPayload({ user: 'U_MUNIN_BOT' }));
    await inbound.processEventCallback(replyPayload({ thread_ts: undefined }));
    await inbound.processEventCallback(replyPayload({ subtype: 'message_changed' }));
    await inbound.processEventCallback(replyPayload({ thread_ts: '1750009999.000001' }));
    await inbound.processEventCallback(replyPayload({ text: '   ' }));

    expect(await messages()).toHaveLength(0);
    expect(api.ephemerals).toHaveLength(0);
  });

  it('deduplicates redelivered events by slack ts', async () => {
    const [member] = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, memberUserId));
    api.usersById.set('U_OPERATOR', { email: member!.email });

    const payload = replyPayload();
    await inbound.processEventCallback(payload);
    await inbound.processEventCallback(payload);

    expect(await messages()).toHaveLength(1);
  });
});
