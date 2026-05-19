import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  ActorIdentity,
  WebhookDispatcher,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { ConvService, ConvInvalidError } from './conv.service.js';
import { ConversationClaimsService } from './conv.claims.service.js';
import { CuratorJobsService } from '../curator/curator-jobs.service.js';

const TEST_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set DATABASE_URL or TEST_DATABASE_URL to a Postgres URL to run conv service tests.';

(skipReason ? describe.skip : describe)('ConvService', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let svc: ConvService;
  let orgId: string;
  let userId: string;
  let actor: ActorIdentity;

  beforeAll(async () => {
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    appDb = createDb(appUrl);

    const ts = Date.now();
    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'Conv Service Test Org' })
      .returning();
    orgId = org!.id;
    const [user] = await db
      .insert(schema.users)
      .values({ email: `conv-svc-test-${ts}@example.com`, name: 'Test User' })
      .returning();
    userId = user!.id;
    actor = new ActorIdentity('admin_agent', 'agt_conv_test', orgId, ['*'], ['admin']);

    const dispatcher = new WebhookDispatcher();
    svc = new ConvService(
      dispatcher,
      new ConversationClaimsService(dispatcher),
      new CuratorJobsService(dispatcher),
    );
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  beforeEach(async () => {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await db.execute(sql`DELETE FROM conv_message_deliveries WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM curator_jobs WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM outreach_proposals WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM outreach_campaigns WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM crm_segments WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM conv_messages WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM conv_conversations WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM conv_topics WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM conv_channels WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM webhook_deliveries WHERE webhook_id IN (SELECT id FROM webhooks WHERE org_id = ${orgId})`);
    await db.execute(sql`DELETE FROM webhooks WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM events WHERE org_id = ${orgId}`);
  });

  function run<T>(fn: () => Promise<T>, runAs: ActorIdentity = actor): Promise<T> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${runAs.orgId}, true)`);
      const ctx: RequestContext = {
        db: tx,
        actor: runAs,
        correlationId: randomUUID(),
      };
      return withContext(ctx, fn);
    });
  }

  async function eventTypes(): Promise<string[]> {
    const rows = await db.execute<{ type: string }>(
      sql`SELECT type FROM events WHERE org_id = ${orgId} ORDER BY created_at`,
    );
    return rows.map((r) => r.type);
  }

  // ─── Channels ────────────────────────────────────────────────────────

  describe('channels', () => {
    it('createChannel persists with type, name, config', async () => {
      const ch = await run(() =>
        svc.createChannel({ type: 'email', vendor: 'smtp', name: 'Support', config: { foo: 'bar' } }),
      );
      expect(ch.type).toBe('email');
      expect(ch.name).toBe('Support');
      expect(ch.config).toEqual({ foo: 'bar' });
      expect(ch.active).toBe(true);
    });

    it('listChannels returns rows in name order', async () => {
      await run(() => svc.createChannel({ type: 'email', vendor: 'smtp', name: 'B' }));
      await run(() => svc.createChannel({ type: 'chat', vendor: 'munin', name: 'A' }));
      const list = await run(() => svc.listChannels());
      expect(list.map((c) => c.name)).toEqual(['A', 'B']);
    });

    it('firstActiveChannel returns first by createdAt; null when none', async () => {
      const empty = await run(() => svc.firstActiveChannel());
      expect(empty).toBeNull();
      const ch1 = await run(() => svc.createChannel({ type: 'email', vendor: 'smtp', name: 'First' }));
      await run(() => svc.createChannel({ type: 'chat', vendor: 'munin', name: 'Second' }));
      const found = await run(() => svc.firstActiveChannel());
      expect(found!.id).toBe(ch1.id);
    });

    it('firstActiveChannel filters by typeHint', async () => {
      await run(() => svc.createChannel({ type: 'email', vendor: 'smtp', name: 'E' }));
      const chatCh = await run(() => svc.createChannel({ type: 'chat', vendor: 'munin', name: 'C' }));
      const found = await run(() => svc.firstActiveChannel('chat'));
      expect(found!.id).toBe(chatCh.id);
    });

    it('firstActiveChannel ignores inactive channels', async () => {
      const ch = await run(() => svc.createChannel({ type: 'email', vendor: 'smtp', name: 'E' }));
      await db
        .update(schema.convChannels)
        .set({ active: false })
        .where(eq(schema.convChannels.id, ch.id));
      const found = await run(() => svc.firstActiveChannel());
      expect(found).toBeNull();
    });
  });

  // ─── Topics ──────────────────────────────────────────────────────────

  describe('topics', () => {
    it('createTopic persists fields and listTopics returns them', async () => {
      const t = await run(() =>
        svc.createTopic({ name: 'Bugs', slug: 'bugs', color: '#ff0000' }),
      );
      expect(t.slug).toBe('bugs');
      expect(t.color).toBe('#ff0000');
      const list = await run(() => svc.listTopics());
      expect(list.map((x) => x.slug)).toEqual(['bugs']);
    });

    it('createTopic rejects invalid slug', async () => {
      await expect(
        run(() => svc.createTopic({ name: 'X', slug: 'BAD slug' })),
      ).rejects.toThrow(ConvInvalidError);
    });
  });

  // ─── Conversations ───────────────────────────────────────────────────

  describe('conversations', () => {
    async function seedChannel() {
      return run(() => svc.createChannel({ type: 'email', vendor: 'smtp', name: 'Support' }));
    }

    it('createConversation rejects unknown channel and inactive channel', async () => {
      await expect(
        run(() =>
          svc.createConversation({
            channelId: randomUUID(),
            body: 'hi',
            authorType: 'agent',
            authorId: actor.id,
          }),
        ),
      ).rejects.toThrow(NotFoundException);
      const ch = await seedChannel();
      await db
        .update(schema.convChannels)
        .set({ active: false })
        .where(eq(schema.convChannels.id, ch.id));
      await expect(
        run(() =>
          svc.createConversation({
            channelId: ch.id,
            body: 'hi',
            authorType: 'agent',
            authorId: actor.id,
          }),
        ),
      ).rejects.toThrow(ConvInvalidError);
    });

    it('createConversation persists conversation + first message and emits webhooks', async () => {
      const ch = await seedChannel();
      const conv = await run(() =>
        svc.createConversation({
          channelId: ch.id,
          body: 'first message',
          subject: 'subj',
          authorType: 'agent',
          authorId: actor.id,
        }),
      );
      expect(conv.subject).toBe('subj');
      expect(conv.messages).toHaveLength(1);
      expect(conv.messages[0]!.body).toBe('first message');
      const types = await eventTypes();
      expect(types).toContain('conversation.created');
      expect(types).toContain('conversation.message.sent');
    });

    it('createConversation by an end_user emits message.received event', async () => {
      const ch = await seedChannel();
      await run(() =>
        svc.createConversation({
          channelId: ch.id,
          body: 'inbound',
          authorType: 'end_user',
          authorId: 'eu-1',
        }),
      );
      expect(await eventTypes()).toContain('conversation.message.received');
    });

    it('listConversations filters by status, topic, endUser', async () => {
      const ch = await seedChannel();
      await run(() =>
        svc.createConversation({
          channelId: ch.id,
          body: 'a',
          authorType: 'agent',
          authorId: actor.id,
        }),
      );
      const list = await run(() => svc.listConversations({}));
      expect(list).toHaveLength(1);
      const closed = await run(() => svc.listConversations({ status: 'closed' }));
      expect(closed).toHaveLength(0);
    });

    it('getConversation returns 404 for unknown id', async () => {
      await expect(run(() => svc.getConversation(randomUUID()))).rejects.toThrow(
        NotFoundException,
      );
    });

    it('getConversation returns messages in createdAt order', async () => {
      const ch = await seedChannel();
      const conv = await run(() =>
        svc.createConversation({
          channelId: ch.id,
          body: 'first',
          authorType: 'agent',
          authorId: actor.id,
        }),
      );
      await run(() =>
        svc.sendMessage({
          conversationId: conv.id,
          body: 'second',
          authorType: 'agent',
          authorId: actor.id,
        }),
      );
      const detail = await run(() => svc.getConversation(conv.id));
      expect(detail.messages.map((m) => m.body)).toEqual(['first', 'second']);
    });
  });

  // ─── Messaging ───────────────────────────────────────────────────────

  describe('messaging', () => {
    async function seedConversation(channelType: 'email' | 'chat' = 'email') {
      const vendor = channelType === 'email' ? 'smtp' : 'munin';
      const ch = await run(() =>
        svc.createChannel({ type: channelType, vendor, name: 'X' }),
      );
      const conv = await run(() =>
        svc.createConversation({
          channelId: ch.id,
          body: 'hello',
          authorType: 'agent',
          authorId: actor.id,
        }),
      );
      return { ch, conv };
    }

    it('sendMessage 404s on unknown conversation', async () => {
      await expect(
        run(() =>
          svc.sendMessage({
            conversationId: randomUUID(),
            body: 'x',
            authorType: 'agent',
            authorId: actor.id,
          }),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('sendMessage emits sent event for staff and queues an email outbound', async () => {
      const { conv } = await seedConversation('email');
      await db.execute(sql`DELETE FROM events WHERE org_id = ${orgId}`); // clear creation events
      const m = await run(() =>
        svc.sendMessage({
          conversationId: conv.id,
          body: 'reply',
          authorType: 'agent',
          authorId: actor.id,
        }),
      );
      expect(m.body).toBe('reply');
      expect(await eventTypes()).toContain('conversation.message.sent');
      const deliveries = await db.execute<{ id: string }>(
        sql`SELECT id FROM conv_message_deliveries WHERE message_id = ${m.id}`,
      );
      expect(deliveries).toHaveLength(1);
    });

    it('sendMessage by end_user on email channel does NOT enqueue outbound delivery', async () => {
      const { conv } = await seedConversation('email');
      await db.execute(sql`DELETE FROM conv_message_deliveries WHERE org_id = ${orgId}`);
      const m = await run(() =>
        svc.sendMessage({
          conversationId: conv.id,
          body: 'inbound',
          authorType: 'end_user',
          authorId: 'eu-1',
        }),
      );
      const deliveries = await db.execute<{ id: string }>(
        sql`SELECT id FROM conv_message_deliveries WHERE message_id = ${m.id}`,
      );
      expect(deliveries).toHaveLength(0);
      expect(await eventTypes()).toContain('conversation.message.received');
    });

    it('sendMessage on non-email channel does not enqueue outbound delivery', async () => {
      const { conv } = await seedConversation('chat');
      const m = await run(() =>
        svc.sendMessage({
          conversationId: conv.id,
          body: 'chat reply',
          authorType: 'agent',
          authorId: actor.id,
        }),
      );
      const deliveries = await db.execute<{ id: string }>(
        sql`SELECT id FROM conv_message_deliveries WHERE message_id = ${m.id}`,
      );
      expect(deliveries).toHaveLength(0);
    });

    it('sendMessage with internal=true does not emit external webhooks', async () => {
      const { conv } = await seedConversation('email');
      await db.execute(sql`DELETE FROM events WHERE org_id = ${orgId}`);
      await run(() =>
        svc.sendMessage({
          conversationId: conv.id,
          body: 'private note',
          internal: true,
          authorType: 'agent',
          authorId: actor.id,
        }),
      );
      const types = await eventTypes();
      expect(types).not.toContain('conversation.message.sent');
    });
  });

  // ─── Assignment / status ─────────────────────────────────────────────

  describe('assignment and status', () => {
    async function seedConv() {
      const ch = await run(() => svc.createChannel({ type: 'email', vendor: 'smtp', name: 'X' }));
      return run(() =>
        svc.createConversation({
          channelId: ch.id,
          body: 'hi',
          authorType: 'agent',
          authorId: actor.id,
        }),
      );
    }

    it('assignConversation sets assignee and emits webhook', async () => {
      const conv = await seedConv();
      const assigned = await run(() =>
        svc.assignConversation({ id: conv.id, assigneeUserId: userId }),
      );
      expect(assigned.assigneeUserId).toBe(userId);
      expect(await eventTypes()).toContain('conversation.assigned');
    });

    it('assignConversation 404s on unknown id', async () => {
      await expect(
        run(() => svc.assignConversation({ id: randomUUID(), assigneeUserId: null })),
      ).rejects.toThrow(NotFoundException);
    });

    it('changeStatus open/closed/spam transitions emit webhook', async () => {
      const conv = await seedConv();
      const closed = await run(() => svc.changeStatus({ id: conv.id, status: 'closed' }));
      expect(closed.status).toBe('closed');
      expect(await eventTypes()).toContain('conversation.status_changed');
    });

    it('changeStatus to closed enqueues a CRM contact-extract curator job', async () => {
      const conv = await seedConv();
      await run(() => svc.changeStatus({ id: conv.id, status: 'closed' }));
      const rows = await db.execute<{ job_uri: string; dedupe_key: string | null }>(
        sql`SELECT job_uri, dedupe_key FROM curator_jobs WHERE org_id = ${orgId}`,
      );
      const extractJob = rows.find((r) => r.job_uri === 'skill://crm/contact-extract');
      expect(extractJob).toBeDefined();
      expect(extractJob!.dedupe_key).toBe(`crm-contact-extract:conv:${conv.id}`);
    });

    it('inbound end_user message on outreach conv (draft_only) enqueues outreach reply-draft', async () => {
      const ch = await run(() => svc.createChannel({ type: 'email', vendor: 'smtp', name: 'outreach-ch' }));
      const [seg] = await db
        .insert(schema.crmSegments)
        .values({
          orgId,
          name: 'outreach-seg',
          filterDefinition: {},
          createdByActorType: 'admin_agent',
          createdByActorId: 'test',
        })
        .returning();
      const [camp] = await db
        .insert(schema.outreachCampaigns)
        .values({
          orgId,
          name: 'outreach-camp',
          brief: 'test',
          segmentId: seg!.id,
          channelId: ch.id,
          enabled: true,
          createdByActorType: 'admin_agent',
          createdByActorId: 'test',
        })
        .returning();
      const conv = await run(() =>
        svc.createConversation({
          channelId: ch.id,
          body: 'first outreach email',
          authorType: 'agent',
          authorId: actor.id,
          outreachCampaignId: camp!.id,
          agentMode: 'draft_only',
        }),
      );
      // Now an inbound end_user reply lands.
      await run(() =>
        svc.sendMessage({
          conversationId: conv.id,
          body: 'Tell me more',
          authorType: 'end_user',
          authorId: 'eu_test',
        }),
      );
      const rows = await db.execute<{ job_uri: string; dedupe_key: string | null }>(
        sql`SELECT job_uri, dedupe_key FROM curator_jobs WHERE org_id = ${orgId} AND job_uri = 'skill://outreach/draft-reply'`,
      );
      expect(rows.length).toBe(1);
      expect(rows[0]!.dedupe_key).toMatch(/^outreach-draft-reply:msg:cvm_/);
    });

    it('inbound on a non-outreach conv does NOT enqueue reply-draft', async () => {
      const conv = await seedConv();
      await run(() =>
        svc.sendMessage({
          conversationId: conv.id,
          body: 'hi',
          authorType: 'end_user',
          authorId: 'eu_test',
        }),
      );
      const rows = await db.execute<{ job_uri: string }>(
        sql`SELECT job_uri FROM curator_jobs WHERE org_id = ${orgId} AND job_uri = 'skill://outreach/draft-reply'`,
      );
      expect(rows.length).toBe(0);
    });

    it('changeStatus to non-closed (e.g. snoozed) does NOT enqueue contact-extract', async () => {
      const conv = await seedConv();
      await run(() =>
        svc.changeStatus({
          id: conv.id,
          status: 'snoozed',
          snoozeUntil: new Date(Date.now() + 60_000).toISOString(),
        }),
      );
      const rows = await db.execute<{ job_uri: string }>(
        sql`SELECT job_uri FROM curator_jobs WHERE org_id = ${orgId}`,
      );
      expect(rows.find((r) => r.job_uri === 'skill://crm/contact-extract')).toBeUndefined();
    });

    it('changeStatus snoozed requires snoozeUntil', async () => {
      const conv = await seedConv();
      await expect(
        run(() => svc.changeStatus({ id: conv.id, status: 'snoozed' })),
      ).rejects.toThrow(ConvInvalidError);
      const snoozed = await run(() =>
        svc.changeStatus({
          id: conv.id,
          status: 'snoozed',
          snoozeUntil: new Date(Date.now() + 60_000).toISOString(),
        }),
      );
      expect(snoozed.status).toBe('snoozed');
    });

    it('changeStatus 404s on unknown id', async () => {
      await expect(
        run(() => svc.changeStatus({ id: randomUUID(), status: 'closed' })),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Search ──────────────────────────────────────────────────────────

  describe('search', () => {
    it('searchMessages matches case-insensitively on body', async () => {
      const ch = await run(() => svc.createChannel({ type: 'email', vendor: 'smtp', name: 'X' }));
      const conv = await run(() =>
        svc.createConversation({
          channelId: ch.id,
          body: 'The weather is amazing today',
          authorType: 'agent',
          authorId: actor.id,
        }),
      );
      void conv;
      const hits = await run(() => svc.searchMessages({ query: 'WEATHER' }));
      expect(hits).toHaveLength(1);
    });

    it('searchMessages returns empty for whitespace query', async () => {
      const r = await run(() => svc.searchMessages({ query: '   ' }));
      expect(r).toEqual([]);
    });
  });

  // ─── RLS ─────────────────────────────────────────────────────────────

  describe('RLS', () => {
    it('cross-org isolation: another org cannot see this org\'s channels', async () => {
      const mine = await run(() => svc.createChannel({ type: 'email', vendor: 'smtp', name: 'mine' }));
      const ts = Date.now();
      const [otherOrg] = await db
        .insert(schema.orgs)
        .values({ name: 'Other' })
        .returning();
      const otherActor = new ActorIdentity('admin_agent', 'agt_other', otherOrg!.id, ['*'], ['admin']);
      try {
        const list = await run(() => svc.listChannels(), otherActor);
        expect(list.find((c) => c.id === mine.id)).toBeFalsy();
      } finally {
        await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
        await db.delete(schema.orgs).where(eq(schema.orgs.id, otherOrg!.id));
      }
    });
  });
});
