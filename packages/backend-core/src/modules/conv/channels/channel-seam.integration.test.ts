import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { WebhookDispatcher } from '@getmunin/core';
import { eq, sql } from 'drizzle-orm';
import { CuratorJobsService } from '../../curator/curator-jobs.service.ts';
import { ChannelIngestService } from './channel-ingest.service.ts';
import { OutboundDeliveryWorker } from './outbound-delivery.worker.ts';
import { ChannelSendDeferredError, ChannelSendTerminalError } from './send-outcome.ts';
import { parseRateLimitDeferral } from './send-rate-limit.ts';
import type { ChannelAdapter, ChannelRow, InboundBatch, SendContext } from './adapter.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run channel seam integration tests.';

type SendBehaviour = (ctx: SendContext) => Promise<{ providerMessageId: string | null }>;

class ScriptedAdapter implements ChannelAdapter {
  readonly kind = 'chat' as const;
  readonly vendors = ['scripted'] as const;
  readonly outboundDelivery = 'queued' as const;
  readonly inbound = null;

  behaviour: SendBehaviour = () => Promise.resolve({ providerMessageId: 'ok' });
  readonly seen: SendContext[] = [];

  send(ctx: SendContext): Promise<{ providerMessageId: string | null }> {
    this.seen.push(ctx);
    return this.behaviour(ctx);
  }
}

(skipReason ? describe.skip : describe)('channel seam: handle identity, conversation keys, delivery outcomes', () => {
  let db: ReturnType<typeof createDb>;
  let ingest: ChannelIngestService;
  let worker: OutboundDeliveryWorker;
  let adapter: ScriptedAdapter;
  let orgId: string;
  let channel: ChannelRow;

  const message = (
    over: Partial<InboundBatch['messages'][number]> & { providerMessageId: string },
  ): InboundBatch['messages'][number] => ({
    fromIdentity: {},
    body: 'body',
    receivedAt: new Date(),
    ...over,
  });

  beforeAll(async () => {
    process.env.MUNIN_ENCRYPTION_KEY ??= 'integration-test-encryption-key';
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const [org] = await db.insert(schema.orgs).values({ name: 'Channel Seam Org' }).returning();
    orgId = org!.id;

    const [row] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'chat', vendor: 'scripted', name: 'Scripted' })
      .returning();
    channel = {
      id: row!.id,
      orgId,
      type: row!.type,
      vendor: row!.vendor,
      name: row!.name,
      config: {},
      active: row!.active,
      defaultAgentMode: row!.defaultAgentMode,
    };

    const dispatcher = new WebhookDispatcher();
    ingest = new ChannelIngestService(db, dispatcher, new CuratorJobsService(dispatcher));
    adapter = new ScriptedAdapter();
    worker = new OutboundDeliveryWorker(db, dispatcher, [adapter]);
  });

  afterAll(async () => {
    if (db && orgId) await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId));
  });

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM conv_message_deliveries WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM conv_messages WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM conv_conversations WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM conv_contacts WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM end_users WHERE org_id = ${orgId}`);
    adapter.behaviour = () => Promise.resolve({ providerMessageId: 'ok' });
  });

  describe('handle identity', () => {
    it('creates one contact for a handle and reuses it for the next message', async () => {
      await ingest.ingest(channel, {
        messages: [message({ providerMessageId: 'm1', fromIdentity: { handle: 'ada_l' } })],
      });
      await ingest.ingest(channel, {
        messages: [message({ providerMessageId: 'm2', fromIdentity: { handle: 'ada_l' } })],
      });

      const contacts = await db
        .select()
        .from(schema.convContacts)
        .where(eq(schema.convContacts.orgId, orgId));
      expect(contacts).toHaveLength(1);
      expect(contacts[0]!.handle).toBe('ada_l');
      expect(contacts[0]!.email).toBeNull();
    });

    it('namespaces the end user external id by channel vendor so two platforms never collide', async () => {
      await ingest.ingest(channel, {
        messages: [message({ providerMessageId: 'm1', fromIdentity: { handle: 'ada_l' } })],
      });
      const endUsers = await db
        .select()
        .from(schema.endUsers)
        .where(eq(schema.endUsers.orgId, orgId));
      expect(endUsers).toHaveLength(1);
      expect(endUsers[0]!.externalId).toBe('scripted:ada_l');
    });

    it('threads two handle messages into one conversation', async () => {
      await ingest.ingest(channel, {
        messages: [
          message({ providerMessageId: 'm1', fromIdentity: { handle: 'ada_l' } }),
          message({ providerMessageId: 'm2', fromIdentity: { handle: 'ada_l' } }),
        ],
      });
      const convs = await db
        .select()
        .from(schema.convConversations)
        .where(eq(schema.convConversations.orgId, orgId));
      expect(convs).toHaveLength(1);
    });

    it('prefers an existing email contact over creating a handle contact', async () => {
      const [existing] = await db
        .insert(schema.convContacts)
        .values({ orgId, email: 'ada@example.com' })
        .returning();

      await ingest.ingest(channel, {
        messages: [
          message({
            providerMessageId: 'm1',
            fromIdentity: { email: 'ada@example.com', handle: 'ada_l' },
          }),
        ],
      });

      const contacts = await db
        .select()
        .from(schema.convContacts)
        .where(eq(schema.convContacts.orgId, orgId));
      expect(contacts).toHaveLength(1);
      expect(contacts[0]!.id).toBe(existing!.id);
    });
  });

  describe('conversation keys', () => {
    it('lands two different authors in the same keyed conversation as distinct message authors', async () => {
      await ingest.ingest(channel, {
        messages: [
          message({
            providerMessageId: 'c1',
            fromIdentity: { handle: 'first_redditor' },
            conversationKey: 'reddit:thread:abc123',
          }),
          message({
            providerMessageId: 'c2',
            fromIdentity: { handle: 'second_redditor' },
            conversationKey: 'reddit:thread:abc123',
          }),
        ],
      });

      const convs = await db
        .select()
        .from(schema.convConversations)
        .where(eq(schema.convConversations.orgId, orgId));
      expect(convs).toHaveLength(1);
      expect(convs[0]!.metadata).toMatchObject({ conversationKey: 'reddit:thread:abc123' });

      const messages = await db
        .select()
        .from(schema.convMessages)
        .where(eq(schema.convMessages.conversationId, convs[0]!.id));
      expect(messages).toHaveLength(2);
      expect(new Set(messages.map((m) => m.authorId)).size).toBe(2);
    });

    it('keeps a keyed message out of the same author existing unkeyed conversation', async () => {
      await ingest.ingest(channel, {
        messages: [message({ providerMessageId: 'dm1', fromIdentity: { handle: 'ada_l' } })],
      });
      await ingest.ingest(channel, {
        messages: [
          message({
            providerMessageId: 'c1',
            fromIdentity: { handle: 'ada_l' },
            conversationKey: 'reddit:thread:abc123',
          }),
        ],
      });

      const convs = await db
        .select()
        .from(schema.convConversations)
        .where(eq(schema.convConversations.orgId, orgId));
      expect(convs).toHaveLength(2);
      const keyed = convs.filter((c) => c.metadata && 'conversationKey' in c.metadata);
      expect(keyed).toHaveLength(1);
    });

    it('reopens a closed keyed conversation rather than colliding on its unique key', async () => {
      await ingest.ingest(channel, {
        messages: [
          message({
            providerMessageId: 'c1',
            fromIdentity: { handle: 'ada_l' },
            conversationKey: 'reddit:thread:abc123',
          }),
        ],
      });
      await db
        .update(schema.convConversations)
        .set({ status: 'closed' })
        .where(eq(schema.convConversations.orgId, orgId));

      const result = await ingest.ingest(channel, {
        messages: [
          message({
            providerMessageId: 'c2',
            fromIdentity: { handle: 'ada_l' },
            conversationKey: 'reddit:thread:abc123',
          }),
        ],
      });

      expect(result.ingested).toBe(1);
      const convs = await db
        .select()
        .from(schema.convConversations)
        .where(eq(schema.convConversations.orgId, orgId));
      expect(convs).toHaveLength(1);
      expect(convs[0]!.status).toBe('open');
    });
  });

  describe('adapter-signalled delivery outcomes', () => {
    async function queueDelivery(): Promise<string> {
      const [conv] = await db
        .insert(schema.convConversations)
        .values({ orgId, displayId: Math.floor(Math.random() * 1_000_000), channelId: channel.id })
        .returning();
      const [msg] = await db
        .insert(schema.convMessages)
        .values({
          orgId,
          conversationId: conv!.id,
          authorType: 'agent',
          authorId: 'agt_test',
          body: 'outbound',
        })
        .returning();
      const [delivery] = await db
        .insert(schema.convMessageDeliveries)
        .values({
          orgId,
          messageId: msg!.id,
          channelId: channel.id,
          status: 'queued',
          nextAttemptAt: new Date(Date.now() - 1_000),
        })
        .returning();
      return delivery!.id;
    }

    async function readDelivery(id: string) {
      const rows = await db
        .select()
        .from(schema.convMessageDeliveries)
        .where(eq(schema.convMessageDeliveries.id, id));
      return rows[0]!;
    }

    it('defers without consuming an attempt when the adapter asks to retry later', async () => {
      const id = await queueDelivery();
      const retryAt = new Date(Date.now() + 600_000);
      adapter.behaviour = () =>
        Promise.reject(new ChannelSendDeferredError('429 ratelimit exhausted', retryAt));

      const outcome = await worker.tick();
      expect(outcome.deferred).toBe(1);

      const row = await readDelivery(id);
      expect(row.status).toBe('queued');
      expect(row.attempt).toBe(0);
      expect(row.nextAttemptAt?.getTime()).toBe(retryAt.getTime());
      expect(parseRateLimitDeferral(row.error)).toMatchObject({
        reason: 'provider',
        detail: '429 ratelimit exhausted',
      });
    });

    it('goes dead on the first attempt when the adapter reports a terminal rejection', async () => {
      const id = await queueDelivery();
      adapter.behaviour = () =>
        Promise.reject(new ChannelSendTerminalError('NOT_WHITELISTED_BY_USER_MESSAGE'));

      const outcome = await worker.tick();
      expect(outcome.failed).toBe(1);

      const row = await readDelivery(id);
      expect(row.status).toBe('dead');
      expect(row.attempt).toBe(1);
      expect(row.nextAttemptAt).toBeNull();
      expect(row.error).toBe('NOT_WHITELISTED_BY_USER_MESSAGE');
    });

    it('still retries an ordinary transport error rather than burning the delivery', async () => {
      const id = await queueDelivery();
      adapter.behaviour = () => Promise.reject(new Error('socket hang up'));

      await worker.tick();

      const row = await readDelivery(id);
      expect(row.status).toBe('failed');
      expect(row.attempt).toBe(1);
      expect(row.nextAttemptAt).not.toBeNull();
    });

    it('leaves a deferred delivery claimable again once its retry time passes', async () => {
      const id = await queueDelivery();
      adapter.behaviour = () =>
        Promise.reject(new ChannelSendDeferredError('slow down', new Date(Date.now() - 1_000)));
      await worker.tick();

      adapter.behaviour = () => Promise.resolve({ providerMessageId: 't1_ok' });
      const outcome = await worker.tick();

      expect(outcome.sent).toBe(1);
      const row = await readDelivery(id);
      expect(row.status).toBe('sent');
      expect(row.messageIdHeader).toBe('t1_ok');
    });
  });
});
