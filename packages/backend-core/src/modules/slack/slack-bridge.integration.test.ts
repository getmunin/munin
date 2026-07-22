import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql, eq, and } from 'drizzle-orm';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  ActorIdentity,
  signHmac,
  WebhookDispatcher,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { SlackApiError, SlackApiClient } from './slack-api.client.ts';
import { SlackBridgeWorker } from './slack-bridge.worker.ts';
import { SlackEventSink } from './slack-event-sink.ts';
import { SlackService, encryptSecretValue } from './slack.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run slack bridge tests.';

interface PostedMessage {
  channel: string;
  text: string;
  blocks?: unknown[];
  threadTs?: string;
  ts: string;
}

class FakeSlackApi extends SlackApiClient {
  posted: PostedMessage[] = [];
  updated: { channel: string; ts: string; text: string; blocks?: unknown[] }[] = [];
  failNextPosts = 0;
  private counter = 0;

  override postMessage(input: {
    token: string;
    channel: string;
    text: string;
    blocks?: unknown[];
    threadTs?: string;
  }): Promise<{ ts: string; channel: string }> {
    if (this.failNextPosts > 0) {
      this.failNextPosts -= 1;
      throw new SlackApiError('rate_limited', 1_000);
    }
    this.counter += 1;
    const ts = `1700000000.${String(this.counter).padStart(6, '0')}`;
    this.posted.push({
      channel: input.channel,
      text: input.text,
      blocks: input.blocks,
      threadTs: input.threadTs,
      ts,
    });
    return Promise.resolve({ ts, channel: input.channel });
  }

  override updateMessage(input: {
    token: string;
    channel: string;
    ts: string;
    text: string;
    blocks?: unknown[];
  }): Promise<void> {
    this.updated.push({
      channel: input.channel,
      ts: input.ts,
      text: input.text,
      blocks: input.blocks,
    });
    return Promise.resolve();
  }

  override conversationsInfo(input: { token: string; channel: string }) {
    return Promise.resolve({ id: input.channel, name: 'support', isMember: true });
  }

  channelPages: Array<{
    channels: { id: string; name: string | null; isMember: boolean }[];
    nextCursor: string | null;
  }> | null = [];
  private pageIdx = 0;

  override conversationsList(_input: { token: string; cursor?: string }) {
    if (this.channelPages === null) throw new SlackApiError('internal_error');
    const page = this.channelPages[this.pageIdx] ?? { channels: [], nextCursor: null };
    this.pageIdx += 1;
    return Promise.resolve(page);
  }

  oauthTeamId = 'T_INSTALLED';
  override oauthAccess(_input: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
  }) {
    return Promise.resolve({
      botToken: 'xoxb-installed-token',
      botUserId: 'U_BOT',
      appId: 'A_APP',
      teamId: this.oauthTeamId,
      teamName: 'Installed Space',
    });
  }
}

function actionIds(blocks: unknown[] | undefined): string[] {
  const actions = (blocks ?? []).find(
    (b): b is { type: string; elements: { action_id: string }[] } =>
      typeof b === 'object' && b !== null && (b as { type?: string }).type === 'actions',
  );
  return actions?.elements.map((e) => e.action_id) ?? [];
}

(skipReason ? describe.skip : describe)('Slack bridge', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let orgId: string;
  let channelId: string;
  let contactId: string;
  let integrationId: string;
  let actor: ActorIdentity;
  let displayIdSeq = 0;

  beforeAll(async () => {
    process.env.MUNIN_ENCRYPTION_KEY ??= 'slack-bridge-test-encryption-key';
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    const appUrl = TEST_URL!.replace(
      /(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/,
      '$1munin_app:munin_app@',
    );
    appDb = createDb(appUrl);

    const [org] = await db.insert(schema.orgs).values({ name: 'Slack Bridge Test Org' }).returning();
    orgId = org!.id;
    actor = new ActorIdentity('admin_agent', 'agt_slack_test', orgId, ['*'], ['admin']);

    const [channel] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'email', vendor: 'smtp', name: 'Support inbox' })
      .returning();
    channelId = channel!.id;
    const [contact] = await db
      .insert(schema.convContacts)
      .values({ orgId, name: 'Ada Lovelace', email: 'ada@example.com' })
      .returning();
    contactId = contact!.id;
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  beforeEach(async () => {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await db.delete(schema.slackIntegrations).where(eq(schema.slackIntegrations.orgId, orgId));
    await db.execute(sql`DELETE FROM conv_messages WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM conv_conversations WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM events WHERE org_id = ${orgId}`);

    const encryptedBotToken = await encryptSecretValue(db, 'xoxb-test-token');
    const [integration] = await db
      .insert(schema.slackIntegrations)
      .values({ orgId, teamId: 'T_TEST', teamName: 'Testspace', encryptedBotToken })
      .returning();
    integrationId = integration!.id;
    await db.insert(schema.slackChannelRoutes).values({
      orgId,
      integrationId,
      teamId: 'T_TEST',
      slackChannelId: 'C_DEFAULT',
      purpose: 'default',
    });
  });

  function run<T>(fn: () => Promise<T>, runAs: ActorIdentity = actor): Promise<T> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${runAs.orgId}, true)`);
      await tx.execute(
        sql`SELECT set_config('app.crypt_key', ${process.env.MUNIN_ENCRYPTION_KEY ?? ''}, true)`,
      );
      const ctx: RequestContext = { db: tx, actor: runAs, correlationId: randomUUID() };
      return withContext(ctx, fn);
    });
  }

  async function seedConversation(): Promise<string> {
    displayIdSeq += 1;
    const [conversation] = await db
      .insert(schema.convConversations)
      .values({
        orgId,
        displayId: displayIdSeq,
        channelId,
        contactId,
        subject: 'Password reset',
      })
      .returning();
    return conversation!.id;
  }

  async function seedMessage(conversationId: string, body: string, internal = false) {
    const [message] = await db
      .insert(schema.convMessages)
      .values({
        orgId,
        conversationId,
        authorType: 'end_user',
        authorId: contactId,
        body,
        internal,
      })
      .returning();
    return message!.id;
  }

  async function enqueue(
    eventType: string,
    conversationId: string,
    payload: Record<string, unknown>,
  ) {
    const [event] = await db
      .insert(schema.events)
      .values({ orgId, type: eventType, payload })
      .returning();
    await db.insert(schema.slackDeliveries).values({
      orgId,
      integrationId,
      eventId: event!.id,
      eventType,
      conversationId,
      nextAttemptAt: new Date(),
    });
  }

  it('mirrors a conversation into a lazily-created thread', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const conversationId = await seedConversation();
    const messageId = await seedMessage(conversationId, 'I need help with my order');

    await enqueue('conversation.created', conversationId, { conversationId });
    await enqueue('conversation.message.received', conversationId, {
      conversationId,
      messageId,
      authorType: 'end_user',
      internal: false,
    });

    const result = await worker.tick();
    expect(result.delivered).toBe(2);
    expect(api.posted).toHaveLength(2);

    const [parent, reply] = api.posted;
    expect(parent!.channel).toBe('C_DEFAULT');
    expect(parent!.threadTs).toBeUndefined();
    expect(parent!.text).toContain('Ada Lovelace');
    expect(parent!.text).toContain('*Status:* open');
    expect(actionIds(parent!.blocks)).toEqual(['munin_claim', 'munin_close']);
    expect(reply!.threadTs).toBe(parent!.ts);
    expect(reply!.text).toContain('I need help with my order');

    const [link] = await db
      .select()
      .from(schema.slackConversationLinks)
      .where(eq(schema.slackConversationLinks.conversationId, conversationId));
    expect(link?.slackThreadTs).toBe(parent!.ts);

    const [messageLink] = await db
      .select()
      .from(schema.slackMessageLinks)
      .where(eq(schema.slackMessageLinks.messageId, messageId));
    expect(messageLink?.origin).toBe('mirrored');
  });

  it('never posts a message that already has a slack ts (loop prevention)', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const conversationId = await seedConversation();
    const messageId = await seedMessage(conversationId, 'hello');
    await db.insert(schema.slackConversationLinks).values({
      orgId,
      integrationId,
      conversationId,
      slackChannelId: 'C_DEFAULT',
      slackThreadTs: '1690000000.000001',
    });
    await db.insert(schema.slackMessageLinks).values({
      orgId,
      conversationId,
      messageId,
      slackChannelId: 'C_DEFAULT',
      slackTs: '1690000000.000002',
      origin: 'slack',
    });

    await enqueue('conversation.message.sent', conversationId, { conversationId, messageId });
    const result = await worker.tick();
    expect(result.delivered).toBe(1);
    expect(api.posted).toHaveLength(0);
  });

  it('posts escalation alerts to the escalations route with the mention', async () => {
    await db.insert(schema.slackChannelRoutes).values({
      orgId,
      integrationId,
      teamId: 'T_TEST',
      slackChannelId: 'C_ESCALATIONS',
      purpose: 'escalations',
      mention: '<!here>',
    });
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const conversationId = await seedConversation();
    await enqueue('conversation.handover_requested', conversationId, {
      conversationId,
      reason: 'Customer requests a human',
    });

    await worker.tick();
    const alert = api.posted.find((p) => p.channel === 'C_ESCALATIONS');
    expect(alert).toBeDefined();
    expect(alert!.text).toContain('<!here>');
    expect(alert!.text).toContain('Customer requests a human');
    const threadReply = api.posted.find((p) => p.channel === 'C_DEFAULT' && p.threadTs);
    expect(threadReply!.text).toContain('Human attention requested');
  });

  it('keeps per-conversation ordering when a delivery fails (head-of-line)', async () => {
    const api = new FakeSlackApi();
    api.failNextPosts = 1;
    const worker = new SlackBridgeWorker(db, api);
    const conversationId = await seedConversation();
    const firstId = await seedMessage(conversationId, 'first');
    const secondId = await seedMessage(conversationId, 'second');
    await enqueue('conversation.message.received', conversationId, {
      conversationId,
      messageId: firstId,
    });
    await enqueue('conversation.message.received', conversationId, {
      conversationId,
      messageId: secondId,
    });

    const first = await worker.tick();
    expect(first.delivered).toBe(0);
    expect(api.posted).toHaveLength(0);

    const pending = await db
      .select()
      .from(schema.slackDeliveries)
      .where(
        and(
          eq(schema.slackDeliveries.conversationId, conversationId),
          sql`delivered_at IS NULL`,
        ),
      );
    expect(pending).toHaveLength(2);

    await db
      .update(schema.slackDeliveries)
      .set({ nextAttemptAt: new Date() })
      .where(eq(schema.slackDeliveries.conversationId, conversationId));
    const second = await worker.tick();
    const third = await worker.tick();
    expect(second.delivered + third.delivered).toBe(2);
    const texts = api.posted.map((p) => p.text).join('\n---\n');
    expect(texts.indexOf('first')).toBeLessThan(texts.indexOf('second'));
  });

  it('mirrors message attachments as paperclip links', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const conversationId = await seedConversation();
    const [message] = await db
      .insert(schema.convMessages)
      .values({
        orgId,
        conversationId,
        authorType: 'end_user',
        authorId: contactId,
        body: 'invoice attached',
        attachments: [
          { url: 'https://files.example.com/invoice.pdf', name: 'invoice.pdf' },
          { garbage: true },
        ],
      })
      .returning();
    await enqueue('conversation.message.received', conversationId, {
      conversationId,
      messageId: message!.id,
    });

    await worker.tick();

    const reply = api.posted.find((p) => p.threadTs);
    expect(reply!.text).toContain(':paperclip: <https://files.example.com/invoice.pdf|invoice.pdf>');
  });

  it('manages manual user links: link, relink, list, unlink', async () => {
    const api = new FakeSlackApi();
    const service = new SlackService(db, api);
    const ts = Date.now();
    const [member] = await db
      .insert(schema.users)
      .values({ email: `slack-linked-${ts}@example.com`, name: 'Linked Member' })
      .returning();
    await db.insert(schema.orgMembers).values({ orgId, userId: member!.id });
    try {
      const link = await run(() =>
        service.linkUser({ slackUserId: 'U_MANUAL', userId: member!.id }),
      );
      expect(link.userId).toBe(member!.id);

      await expect(
        run(() => service.linkUser({ slackUserId: 'U_MANUAL', userId: 'usr_not_a_member' })),
      ).rejects.toThrow(BadRequestException);

      const links = await run(() => service.listUserLinks());
      expect(links.map((l) => l.slackUserId)).toContain('U_MANUAL');

      const unlinked = await run(() => service.unlinkUser({ slackUserId: 'U_MANUAL' }));
      expect(unlinked).toMatchObject({ unlinked: true });
      await expect(run(() => service.unlinkUser({ slackUserId: 'U_MANUAL' }))).rejects.toThrow(
        NotFoundException,
      );
    } finally {
      await db.execute(sql`DELETE FROM org_members WHERE user_id = ${member!.id}`);
      await db.delete(schema.users).where(eq(schema.users.id, member!.id));
    }
  });

  it('updates the parent message on status changes and swaps to a Reopen button', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const conversationId = await seedConversation();
    await db
      .update(schema.convConversations)
      .set({ status: 'closed' })
      .where(eq(schema.convConversations.id, conversationId));
    await enqueue('conversation.status_changed', conversationId, { conversationId, status: 'closed' });

    await worker.tick();

    const parent = api.posted.find((p) => !p.threadTs);
    expect(api.updated).toHaveLength(1);
    expect(api.updated[0]!.ts).toBe(parent!.ts);
    expect(api.updated[0]!.text).toContain('*Status:* closed');
    expect(actionIds(api.updated[0]!.blocks)).toEqual(['munin_reopen']);
  });

  it('mirrors into a source-channel override route when one matches', async () => {
    const [smsChannel] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'sms', vendor: 'twilio', name: 'SMS line' })
      .returning();
    await db.insert(schema.slackChannelRoutes).values({
      orgId,
      integrationId,
      teamId: 'T_TEST',
      slackChannelId: 'C_SMS',
      purpose: 'default',
      convChannelId: smsChannel!.id,
    });
    displayIdSeq += 1;
    const [conversation] = await db
      .insert(schema.convConversations)
      .values({ orgId, displayId: displayIdSeq, channelId: smsChannel!.id, contactId })
      .returning();
    await enqueue('conversation.created', conversation!.id, { conversationId: conversation!.id });

    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    await worker.tick();

    const parent = api.posted.find((p) => !p.threadTs);
    expect(parent!.channel).toBe('C_SMS');
  });

  it('enqueues deliveries from the event sink only for mirrored events', async () => {
    const dispatcher = new WebhookDispatcher();
    dispatcher.registerSink(new SlackEventSink());
    const conversationId = await seedConversation();

    await run(async () => {
      await dispatcher.emit({
        type: 'conversation.message.received',
        payload: { conversationId, messageId: 'cvm_x', authorType: 'end_user', internal: false },
      });
      await dispatcher.emit({ type: 'kb.document.created', payload: { documentId: 'kdoc_x' } });
    });

    const rows = await db
      .select()
      .from(schema.slackDeliveries)
      .where(eq(schema.slackDeliveries.orgId, orgId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.eventType).toBe('conversation.message.received');
    expect(rows[0]!.conversationId).toBe(conversationId);
  });

  it('does not enqueue when the org has no active integration', async () => {
    await db
      .update(schema.slackIntegrations)
      .set({ active: false })
      .where(eq(schema.slackIntegrations.id, integrationId));
    const dispatcher = new WebhookDispatcher();
    dispatcher.registerSink(new SlackEventSink());
    const conversationId = await seedConversation();

    await run(async () => {
      await dispatcher.emit({
        type: 'conversation.message.received',
        payload: { conversationId, messageId: 'cvm_y' },
      });
    });

    const rows = await db
      .select()
      .from(schema.slackDeliveries)
      .where(eq(schema.slackDeliveries.orgId, orgId));
    expect(rows).toHaveLength(0);
  });

  it('rejects routing a channel already claimed by another org', async () => {
    const api = new FakeSlackApi();
    const service = new SlackService(db, api);

    const [otherOrg] = await db
      .insert(schema.orgs)
      .values({ name: 'Slack Bridge Other Org' })
      .returning();
    try {
      const encrypted = await encryptSecretValue(db, 'xoxb-other-token');
      const [otherIntegration] = await db
        .insert(schema.slackIntegrations)
        .values({ orgId: otherOrg!.id, teamId: 'T_TEST', encryptedBotToken: encrypted })
        .returning();
      await db.insert(schema.slackChannelRoutes).values({
        orgId: otherOrg!.id,
        integrationId: otherIntegration!.id,
        teamId: 'T_TEST',
        slackChannelId: 'C_CLAIMED',
        purpose: 'default',
      });

      await expect(
        run(() => service.setRouting({ slackChannelId: 'C_CLAIMED' })),
      ).rejects.toThrow(ConflictException);
    } finally {
      await db.delete(schema.orgs).where(sql`id = ${otherOrg!.id}`);
    }
  });

  it('rejects reusing a slack channel across routes of the same org', async () => {
    const api = new FakeSlackApi();
    const service = new SlackService(db, api);
    await expect(
      run(() => service.setRouting({ slackChannelId: 'C_DEFAULT', purpose: 'escalations' })),
    ).rejects.toThrow(ConflictException);
  });

  it('replaces the default route on repeat setRouting calls', async () => {
    const api = new FakeSlackApi();
    const service = new SlackService(db, api);
    const route = await run(() => service.setRouting({ slackChannelId: 'C_NEW' }));
    expect(route.slackChannelId).toBe('C_NEW');
    expect(route.botInChannel).toBe(true);

    const routes = await db
      .select()
      .from(schema.slackChannelRoutes)
      .where(
        and(
          eq(schema.slackChannelRoutes.integrationId, integrationId),
          eq(schema.slackChannelRoutes.purpose, 'default'),
        ),
      );
    expect(routes).toHaveLength(1);
    expect(routes[0]!.slackChannelId).toBe('C_NEW');
  });

  it('lists workspace channels across pages, sorted by name', async () => {
    const api = new FakeSlackApi();
    api.channelPages = [
      {
        channels: [
          { id: 'C_Z', name: 'zulu', isMember: false },
          { id: 'C_M', name: 'mid', isMember: true },
        ],
        nextCursor: 'page2',
      },
      {
        channels: [{ id: 'C_A', name: 'alpha', isMember: true }],
        nextCursor: null,
      },
    ];
    const service = new SlackService(db, api);
    const { channels } = await run(() => service.listChannels());
    expect(channels.map((c) => c.name)).toEqual(['alpha', 'mid', 'zulu']);
    expect(channels.find((c) => c.id === 'C_Z')?.isMember).toBe(false);
  });

  it('maps a Slack API failure during channel listing to a 400', async () => {
    const api = new FakeSlackApi();
    api.channelPages = null;
    const service = new SlackService(db, api);
    await expect(run(() => service.listChannels())).rejects.toThrow(/slack_api_error/);
  });

  describe('completeInstall', () => {
    const CLIENT_SECRET = 'test-slack-client-secret';
    let priorId: string | undefined;
    let priorSecret: string | undefined;

    beforeAll(() => {
      priorId = process.env.SLACK_CLIENT_ID;
      priorSecret = process.env.SLACK_CLIENT_SECRET;
      process.env.SLACK_CLIENT_ID = 'test-client-id';
      process.env.SLACK_CLIENT_SECRET = CLIENT_SECRET;
    });
    afterAll(() => {
      if (priorId === undefined) delete process.env.SLACK_CLIENT_ID;
      else process.env.SLACK_CLIENT_ID = priorId;
      if (priorSecret === undefined) delete process.env.SLACK_CLIENT_SECRET;
      else process.env.SLACK_CLIENT_SECRET = priorSecret;
    });

    function makeState(fields: { orgId: string; userId: string | null; exp: number; nonce?: string }) {
      const payload = Buffer.from(JSON.stringify(fields)).toString('base64url');
      return `${payload}.${signHmac(payload, CLIENT_SECRET)}`;
    }

    async function integrationTeam(): Promise<string | undefined> {
      const [row] = await db
        .select({ teamId: schema.slackIntegrations.teamId })
        .from(schema.slackIntegrations)
        .where(eq(schema.slackIntegrations.orgId, orgId));
      return row?.teamId;
    }

    it('rejects a session-bound state without the matching cookie nonce', async () => {
      const api = new FakeSlackApi();
      api.oauthTeamId = 'T_TEST';
      const service = new SlackService(db, api);
      const state = makeState({ orgId, userId: null, exp: Date.now() + 60_000, nonce: 'good' });

      await expect(service.completeInstall({ code: 'c', state })).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        service.completeInstall({ code: 'c', state, sessionNonce: 'wrong' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a session-bound state with the matching cookie nonce', async () => {
      const api = new FakeSlackApi();
      api.oauthTeamId = 'T_TEST';
      const service = new SlackService(db, api);
      const state = makeState({ orgId, userId: null, exp: Date.now() + 60_000, nonce: 'good' });

      const result = await service.completeInstall({ code: 'c', state, sessionNonce: 'good' });
      expect(result.orgId).toBe(orgId);
    });

    it('accepts an MCP-minted state (no nonce) without a cookie', async () => {
      const api = new FakeSlackApi();
      api.oauthTeamId = 'T_TEST';
      const service = new SlackService(db, api);
      const state = makeState({ orgId, userId: null, exp: Date.now() + 60_000 });

      const result = await service.completeInstall({ code: 'c', state });
      expect(result.orgId).toBe(orgId);
    });

    it('refuses to repoint an existing org to a different workspace', async () => {
      const api = new FakeSlackApi();
      api.oauthTeamId = 'T_ATTACKER';
      const service = new SlackService(db, api);
      const state = makeState({ orgId, userId: null, exp: Date.now() + 60_000 });

      await expect(service.completeInstall({ code: 'c', state })).rejects.toThrow(
        ConflictException,
      );
      expect(await integrationTeam()).toBe('T_TEST');
    });
  });
});
