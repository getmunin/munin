import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { ActorIdentity, WebhookDispatcher, withContext, type RequestContext } from '@getmunin/core';
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { CuratorJobsService } from '../../curator/curator-jobs.service.ts';
import { ChannelIngestService } from '../channels/channel-ingest.service.ts';
import { ChannelAdminService } from '../channels/channel-admin.service.ts';
import { OutboundDeliveryWorker } from '../channels/outbound-delivery.worker.ts';
import { parseRateLimitDeferral } from '../channels/send-rate-limit.ts';
import type { ChannelRow } from '../channels/adapter.ts';
import { RedditAdapter } from './reddit-adapter.ts';
import { RedditAdminProvider } from './reddit-admin.provider.ts';
import { RedditAdminService } from './reddit-admin.service.ts';
import { RedditAdminTools } from './reddit.tools.ts';
import {
  RedditClientService,
  type RedditHttp,
  type RedditHttpRequest,
  type RedditHttpResponse,
} from './reddit-client.service.ts';
import { DEFAULT_REDDIT_SEND_LIMITS, RedditService, jsonbToStored } from './reddit.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run Reddit channel integration tests.';

const CLIENT_ID = 'reddit-client-id';
const CLIENT_SECRET = 'reddit-client-secret';
const REDDIT_USERNAME = 'munin_bot';
const REDDIT_PASSWORD = 'reddit-account-password';

interface Route {
  match: string;
  respond: (req: RedditHttpRequest) => RedditHttpResponse;
}

class RouterHttp implements RedditHttp {
  seen: RedditHttpRequest[] = [];
  routes: Route[] = [];

  reset(): void {
    this.seen = [];
    this.routes = [
      {
        match: 'access_token',
        respond: () => jsonResponse({ access_token: 'tok', expires_in: 3600 }),
      },
    ];
  }

  on(match: string, respond: (req: RedditHttpRequest) => RedditHttpResponse): void {
    this.routes.unshift({ match, respond });
  }

  request(req: RedditHttpRequest): Promise<RedditHttpResponse> {
    this.seen.push(req);
    const route = this.routes.find((r) => req.url.includes(r.match));
    if (!route) throw new Error(`unrouted reddit call ${req.method} ${req.url}`);
    return Promise.resolve(route.respond(req));
  }

  calls(match: string): RedditHttpRequest[] {
    return this.seen.filter((r) => r.url.includes(match));
  }
}

function jsonResponse(
  body: unknown,
  headers: Record<string, string> = {},
  status = 200,
): RedditHttpResponse {
  return { status, headers, body: JSON.stringify(body) };
}

function formOf(req: RedditHttpRequest): URLSearchParams {
  return new URLSearchParams(req.body ?? '');
}

(skipReason ? describe.skip : describe)('Reddit channel', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let http: RouterHttp;
  let client: RedditClientService;
  let reddit: RedditService;
  let adapter: RedditAdapter;
  let worker: OutboundDeliveryWorker;
  let channelAdmin: ChannelAdminService;
  let tools: RedditAdminTools;
  let orgId: string;
  let otherOrgId: string;
  let actor: ActorIdentity;
  let otherActor: ActorIdentity;
  let channelId: string;
  let channelRow: ChannelRow;

  beforeAll(async () => {
    process.env.MUNIN_ENCRYPTION_KEY ??=
      'dGVzdC1lbmNyeXB0aW9uLWtleS1tdXN0LWJlLWxvbmctZW5vdWdoLWZvci1wZ2NyeXB0bw==';
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    const appUrl = TEST_URL!.replace(
      /(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/,
      '$1munin_app:munin_app@',
    );
    appDb = createDb(appUrl);

    const [org] = await db.insert(schema.orgs).values({ name: 'Reddit IT Org' }).returning();
    orgId = org!.id;
    const [other] = await db.insert(schema.orgs).values({ name: 'Reddit IT Other Org' }).returning();
    otherOrgId = other!.id;
    actor = new ActorIdentity('user', 'usr_reddit', orgId, ['*'], ['admin']);
    otherActor = new ActorIdentity('user', 'usr_other', otherOrgId, ['*'], ['admin']);

    http = new RouterHttp();
    http.reset();
    client = new RedditClientService();
    client.setHttp(http);
    reddit = new RedditService(db);
    const dispatcher = new WebhookDispatcher();
    const ingest = new ChannelIngestService(db, dispatcher, new CuratorJobsService(dispatcher));
    adapter = new RedditAdapter(db, client, reddit, ingest);
    worker = new OutboundDeliveryWorker(db, dispatcher, [adapter]);
    const adminService = new RedditAdminService(reddit, client);
    channelAdmin = new ChannelAdminService([new RedditAdminProvider(adminService)]);
    tools = new RedditAdminTools(reddit, client);
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId));
    await db.delete(schema.orgs).where(eq(schema.orgs.id, otherOrgId));
  });

  async function runAs<T>(as: ActorIdentity, fn: () => Promise<T>): Promise<T> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${as.orgId}, true)`);
      await tx.execute(
        sql`SELECT set_config('app.crypt_key', ${process.env.MUNIN_ENCRYPTION_KEY ?? ''}, true)`,
      );
      const ctx: RequestContext = { db: tx, actor: as, correlationId: randomUUID() };
      return withContext(ctx, fn);
    });
  }

  async function loadChannelRow(id: string): Promise<ChannelRow> {
    const rows = await db.select().from(schema.convChannels).where(eq(schema.convChannels.id, id));
    const row = rows[0]!;
    return {
      id: row.id,
      orgId: row.orgId,
      type: row.type,
      vendor: row.vendor,
      name: row.name,
      config: row.config,
      active: row.active,
      defaultAgentMode: row.defaultAgentMode,
    };
  }

  async function pollTick() {
    const inbound = adapter.inbound;
    if (inbound.mode !== 'poll') throw new Error('the reddit adapter must be a poll adapter');
    return inbound.tick(channelRow);
  }

  async function resetInboundState(): Promise<void> {
    await db.delete(schema.convInboundState).where(eq(schema.convInboundState.channelId, channelId));
  }

  async function clearConversations(): Promise<void> {
    await db.execute(sql`DELETE FROM conv_message_deliveries WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM conv_messages WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM conv_conversations WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM conv_contacts WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM end_users WHERE org_id = ${orgId}`);
  }

  async function seedConversation(metadata: Record<string, unknown>, contactHandle?: string) {
    let contactId: string | null = null;
    if (contactHandle) {
      const [contact] = await db
        .insert(schema.convContacts)
        .values({ orgId, handle: contactHandle, name: contactHandle })
        .returning();
      contactId = contact!.id;
    }
    const [conv] = await db
      .insert(schema.convConversations)
      .values({
        orgId,
        displayId: Math.floor(Math.random() * 1_000_000),
        channelId,
        ...(contactId ? { contactId } : {}),
        metadata,
      })
      .returning();
    return conv!;
  }

  async function queueOutbound(
    conversationId: string,
    body: string,
    metadata: Record<string, unknown> = {},
  ): Promise<string> {
    const [msg] = await db
      .insert(schema.convMessages)
      .values({
        orgId,
        conversationId,
        authorType: 'agent',
        authorId: 'agt_reddit',
        body,
        metadata,
      })
      .returning();
    const [delivery] = await db
      .insert(schema.convMessageDeliveries)
      .values({
        orgId,
        messageId: msg!.id,
        channelId,
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

  describe('channel creation and credential handoff', () => {
    it('creates an inactive chat:reddit channel that stores no secret until the handoff completes', async () => {
      const created = await runAs(actor, () =>
        channelAdmin.configure(
          {
            vendor: 'reddit',
            name: 'Reddit engagement',
            config: { clientId: CLIENT_ID, username: REDDIT_USERNAME },
            defaultAgentMode: 'draft_only',
          },
          { rejectSecrets: true },
        ),
      );
      channelId = created.id;

      expect(created.type).toBe('chat');
      expect(created.vendor).toBe('reddit');
      expect(created.active).toBe(false);
      expect(created.defaultAgentMode).toBe('draft_only');

      const row = await loadChannelRow(channelId);
      expect(JSON.stringify(row.config)).not.toContain(CLIENT_SECRET);
      expect(JSON.stringify(row.config)).not.toContain(REDDIT_PASSWORD);
    });

    it('rejects secrets passed through the agent-facing configure path', async () => {
      await expect(
        runAs(actor, () =>
          channelAdmin.configure(
            {
              vendor: 'reddit',
              name: 'Reddit secrets',
              config: {
                clientId: CLIENT_ID,
                username: REDDIT_USERNAME,
                clientSecret: CLIENT_SECRET,
                password: REDDIT_PASSWORD,
              },
            },
            { rejectSecrets: true },
          ),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('activates the channel once the credential link supplies both secrets, encrypted at rest', async () => {
      const result = await runAs(actor, () =>
        channelAdmin.completeSetup(channelId, {
          clientSecret: CLIENT_SECRET,
          password: REDDIT_PASSWORD,
        }),
      );
      expect(result.ok).toBe(true);

      const row = await loadChannelRow(channelId);
      expect(row.active).toBe(true);
      const stored = jsonbToStored(row.config);
      expect(stored.clientId).toBe(CLIENT_ID);
      expect(stored.username).toBe(REDDIT_USERNAME);
      expect(stored.encryptedClientSecret).not.toContain(CLIENT_SECRET);
      expect(stored.encryptedPassword).not.toContain(REDDIT_PASSWORD);
      expect(JSON.stringify(row.config)).not.toContain(CLIENT_SECRET);
      expect(JSON.stringify(row.config)).not.toContain(REDDIT_PASSWORD);

      channelRow = row;
    });

    it('paces a fresh account by default', async () => {
      const stored = jsonbToStored((await loadChannelRow(channelId)).config);
      expect(stored.sendLimits).toEqual(DEFAULT_REDDIT_SEND_LIMITS);
    });

    it('decrypts both credentials back to plaintext for the adapter', async () => {
      const stored = jsonbToStored((await loadChannelRow(channelId)).config);
      const credentials = await reddit.loadCredentials(channelId, stored);
      expect(credentials).toEqual({
        cacheKey: channelId,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        username: REDDIT_USERNAME,
        password: REDDIT_PASSWORD,
      });
    });

    it('redacts both secrets in the DTO', async () => {
      const dto = await runAs(actor, () =>
        reddit.updateChannel({ channelId, name: 'Reddit engagement' }),
      );
      expect(dto.config.clientSecret).not.toBe(CLIENT_SECRET);
      expect(dto.config.password).not.toBe(REDDIT_PASSWORD);
      expect(dto.config.clientId).toBe(CLIENT_ID);
    });

    it('keeps the stored ciphertext when an update omits the secrets', async () => {
      const before = jsonbToStored((await loadChannelRow(channelId)).config);
      await runAs(actor, () => reddit.updateChannel({ channelId, config: { clientId: 'rotated' } }));
      const after = jsonbToStored((await loadChannelRow(channelId)).config);
      expect(after.clientId).toBe('rotated');
      expect(after.encryptedClientSecret).toBe(before.encryptedClientSecret);
      expect(after.encryptedPassword).toBe(before.encryptedPassword);
      await runAs(actor, () =>
        reddit.updateChannel({ channelId, config: { clientId: CLIENT_ID } }),
      );
      channelRow = await loadChannelRow(channelId);
    });
  });

  describe('inbound poll', () => {
    beforeEach(async () => {
      http.reset();
      client.setHttp(http);
      await clearConversations();
      await resetInboundState();
    });

    function unreadListing() {
      return jsonResponse({
        kind: 'Listing',
        data: {
          children: [
            {
              kind: 't4',
              data: {
                id: 'dm1',
                name: 't4_dm1',
                author: 'ada_l',
                body: 'Saw your comment — can you say more?',
                subject: 'about your comment',
                created_utc: 1_700_000_000,
              },
            },
            {
              kind: 't1',
              data: {
                id: 'c1',
                name: 't1_c1',
                author: 'grace_h',
                body: 'This matches what we do.',
                link_id: 't3_abc123',
                link_title: 'How do you handle X?',
                parent_id: 't1_ours',
                subreddit: 'devops',
                created_utc: 1_700_000_100,
                was_comment: true,
                type: 'comment_reply',
              },
            },
            {
              kind: 't1',
              data: {
                id: 'c2',
                name: 't1_c2',
                author: 'alan_t',
                body: 'Disagree, here is why.',
                link_id: 't3_abc123',
                link_title: 'How do you handle X?',
                parent_id: 't1_c1',
                subreddit: 'devops',
                created_utc: 1_700_000_200,
                was_comment: true,
                type: 'comment_reply',
              },
            },
          ],
        },
      });
    }

    it('lands a DM in a contact-threaded conversation and comment replies in one keyed thread conversation', async () => {
      http.on('/message/unread', () => unreadListing());
      http.on('/api/read_message', () => jsonResponse({}));
      http.on('/api/info', () => jsonResponse({ data: { children: [] } }));

      const result = await pollTick();
      expect(result.messagesIngested).toBe(3);
      expect(result.lastError ?? null).toBeNull();

      const convs = await db
        .select()
        .from(schema.convConversations)
        .where(eq(schema.convConversations.orgId, orgId));
      expect(convs).toHaveLength(2);

      const keyed = convs.find((c) => c.metadata.conversationKey === 'reddit:thread:abc123');
      const unkeyed = convs.find((c) => c.metadata.conversationKey === undefined);
      expect(keyed).toBeDefined();
      expect(unkeyed).toBeDefined();

      const dmMessages = await db
        .select()
        .from(schema.convMessages)
        .where(eq(schema.convMessages.conversationId, unkeyed!.id));
      expect(dmMessages).toHaveLength(1);
      expect(dmMessages[0]!.metadata.providerMessageId).toBe('t4_dm1');

      const threadMessages = await db
        .select()
        .from(schema.convMessages)
        .where(eq(schema.convMessages.conversationId, keyed!.id));
      expect(threadMessages).toHaveLength(2);
      expect(new Set(threadMessages.map((m) => m.authorId)).size).toBe(2);
    });

    it('creates one handle contact per redditor and namespaces the end user by vendor', async () => {
      http.on('/message/unread', () => unreadListing());
      http.on('/api/read_message', () => jsonResponse({}));
      http.on('/api/info', () => jsonResponse({ data: { children: [] } }));
      await pollTick();

      const contacts = await db
        .select()
        .from(schema.convContacts)
        .where(eq(schema.convContacts.orgId, orgId));
      expect(contacts.map((c) => c.handle).sort()).toEqual(['ada_l', 'alan_t', 'grace_h']);
      expect(contacts.every((c) => c.email === null)).toBe(true);

      const endUsers = await db
        .select()
        .from(schema.endUsers)
        .where(eq(schema.endUsers.orgId, orgId));
      expect(endUsers.map((e) => e.externalId).sort()).toEqual([
        'reddit:ada_l',
        'reddit:alan_t',
        'reddit:grace_h',
      ]);
    });

    it('marks every ingested item read in a single batched request', async () => {
      http.on('/message/unread', () => unreadListing());
      http.on('/api/read_message', () => jsonResponse({}));
      http.on('/api/info', () => jsonResponse({ data: { children: [] } }));
      await pollTick();

      const marks = http.calls('/api/read_message');
      expect(marks).toHaveLength(1);
      expect(formOf(marks[0]!).get('id')).toBe('t4_dm1,t1_c1,t1_c2');
    });

    it('self-throttles the next tick so a shared 60s worker cadence does not burn the rate budget', async () => {
      http.on('/message/unread', () => unreadListing());
      http.on('/api/read_message', () => jsonResponse({}));
      http.on('/api/info', () => jsonResponse({ data: { children: [] } }));
      await pollTick();
      const callsAfterFirstTick = http.seen.length;

      const second = await pollTick();
      expect(second.messagesIngested).toBe(0);
      expect(http.seen).toHaveLength(callsAfterFirstTick);
    });

    it('reports a 429 as a poll error instead of throwing, so the channel is never auto-deactivated', async () => {
      http.on('/message/unread', () =>
        jsonResponse({}, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '120' }, 429),
      );
      const result = await pollTick();
      expect(result.messagesIngested).toBe(0);
      expect(result.lastError).toContain('429');
    });

    it('records a mark-read failure without losing the ingested messages', async () => {
      http.on('/message/unread', () => unreadListing());
      http.on('/api/read_message', () => jsonResponse({}, {}, 500));
      http.on('/api/info', () => jsonResponse({ data: { children: [] } }));
      const result = await pollTick();
      expect(result.messagesIngested).toBe(3);
      expect(result.lastError).toContain('reddit_mark_read_failed');

      const state = await db
        .select()
        .from(schema.convInboundState)
        .where(eq(schema.convInboundState.channelId, channelId));
      expect(state[0]!.cursor.lastSeenFullname).toBe('t1_c2');
    });

    it('skips items already behind the cursor when a mark-read failure leaves them unread', async () => {
      http.on('/message/unread', () => unreadListing());
      http.on('/api/read_message', () => jsonResponse({}, {}, 500));
      http.on('/api/info', () => jsonResponse({ data: { children: [] } }));
      await pollTick();

      await db
        .update(schema.convInboundState)
        .set({ lastPolledAt: new Date(Date.now() - 24 * 3_600_000) })
        .where(eq(schema.convInboundState.channelId, channelId));
      http.seen = [];
      const second = await pollTick();
      expect(second.messagesIngested).toBe(0);
      expect(http.calls('/api/read_message')).toHaveLength(0);
    });
  });

  describe('outbound delivery', () => {
    beforeEach(async () => {
      http.reset();
      client.setHttp(http);
      await clearConversations();
    });

    it('sends a DM to the contact handle when the conversation is not a thread', async () => {
      const conv = await seedConversation({}, 'ada_l');
      const deliveryId = await queueOutbound(conv.id, 'Happy to explain — here is the short version.');
      http.on('/api/compose', () => jsonResponse({ json: { errors: [] } }));

      const outcome = await worker.tick();
      expect(outcome.sent).toBe(1);

      const compose = http.calls('/api/compose');
      expect(compose).toHaveLength(1);
      const form = formOf(compose[0]!);
      expect(form.get('to')).toBe('ada_l');
      expect(form.get('api_type')).toBe('json');
      expect(form.get('text')).toBe('Happy to explain — here is the short version.');
      expect((await readDelivery(deliveryId)).status).toBe('sent');
    });

    it('kills a DM with no recipient handle on the first attempt', async () => {
      const conv = await seedConversation({});
      const deliveryId = await queueOutbound(conv.id, 'nobody to send this to');

      await worker.tick();
      const row = await readDelivery(deliveryId);
      expect(row.status).toBe('dead');
      expect(row.attempt).toBe(1);
      expect(row.error).toContain('reddit_no_recipient');
    });

    it('comments on the post itself for the first reply into a thread conversation', async () => {
      const conv = await seedConversation({
        conversationKey: 'reddit:thread:abc123',
        redditTarget: 'comment',
        redditThreadId: 'abc123',
        redditSubreddit: 'devops',
        redditPermalink: '/r/devops/comments/abc123/how_do_you_handle_x/',
        redditParentFullname: 't3_abc123',
      });
      const deliveryId = await queueOutbound(conv.id, 'We solved this with a queue.');
      http.on('/api/comment', () =>
        jsonResponse({
          json: {
            errors: [],
            data: { things: [{ kind: 't1', data: { id: 'new1', name: 't1_new1' } }] },
          },
        }),
      );

      const outcome = await worker.tick();
      expect(outcome.sent).toBe(1);
      expect(formOf(http.calls('/api/comment')[0]!).get('thing_id')).toBe('t3_abc123');

      const row = await readDelivery(deliveryId);
      expect(row.status).toBe('sent');
      expect(row.messageIdHeader).toBe('t1_new1');
    });

    it('attaches a later reply to whoever last spoke to us in the thread', async () => {
      const conv = await seedConversation({
        conversationKey: 'reddit:thread:abc123',
        redditTarget: 'comment',
        redditParentFullname: 't3_abc123',
      });
      const [contact] = await db
        .insert(schema.convContacts)
        .values({ orgId, handle: 'grace_h' })
        .returning();
      await db.insert(schema.convMessages).values({
        orgId,
        conversationId: conv.id,
        authorType: 'end_user',
        authorId: contact!.id,
        body: 'How did you size the queue?',
        metadata: { providerMessageId: 't1_theirs' },
      });
      await queueOutbound(conv.id, 'We started at 10 workers.');
      http.on('/api/comment', () =>
        jsonResponse({
          json: {
            errors: [],
            data: { things: [{ kind: 't1', data: { id: 'new2', name: 't1_new2' } }] },
          },
        }),
      );

      await worker.tick();
      expect(formOf(http.calls('/api/comment')[0]!).get('thing_id')).toBe('t1_theirs');
    });

    it('honours an explicit parent fullname on the outbound message', async () => {
      const conv = await seedConversation({
        conversationKey: 'reddit:thread:abc123',
        redditTarget: 'comment',
        redditParentFullname: 't3_abc123',
      });
      await queueOutbound(conv.id, 'Answering the sibling comment.', {
        redditParentFullname: 't1_sibling',
      });
      http.on('/api/comment', () =>
        jsonResponse({
          json: {
            errors: [],
            data: { things: [{ kind: 't1', data: { id: 'new3', name: 't1_new3' } }] },
          },
        }),
      );

      await worker.tick();
      expect(formOf(http.calls('/api/comment')[0]!).get('thing_id')).toBe('t1_sibling');
    });

    it('comments rather than DMs when a thread conversation carries only the conversation key', async () => {
      const conv = await seedConversation(
        { conversationKey: 'reddit:thread:abc123', redditParentFullname: 't3_abc123' },
        'grace_h',
      );
      await queueOutbound(conv.id, 'answering in the open.');
      http.on('/api/comment', () =>
        jsonResponse({
          json: {
            errors: [],
            data: { things: [{ kind: 't1', data: { id: 'new4', name: 't1_new4' } }] },
          },
        }),
      );

      await worker.tick();
      expect(http.calls('/api/comment')).toHaveLength(1);
      expect(http.calls('/api/compose')).toHaveLength(0);
    });

    it('defers a 429 without consuming an attempt', async () => {
      const conv = await seedConversation({}, 'ada_l');
      const deliveryId = await queueOutbound(conv.id, 'this one hits the rate limit');
      http.on('/api/compose', () =>
        jsonResponse({}, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '120' }, 429),
      );

      const outcome = await worker.tick();
      expect(outcome.deferred).toBe(1);

      const row = await readDelivery(deliveryId);
      expect(row.status).toBe('queued');
      expect(row.attempt).toBe(0);
      const deferral = parseRateLimitDeferral(row.error);
      expect(deferral?.reason).toBe('provider');
      expect(deferral!.until.getTime()).toBeGreaterThan(Date.now() + 100_000);
    });

    it('goes dead on the first attempt when Reddit answers 200 with a json.errors rejection', async () => {
      const conv = await seedConversation({}, 'ada_l');
      const deliveryId = await queueOutbound(conv.id, 'this account cannot receive DMs');
      http.on('/api/compose', () =>
        jsonResponse({
          json: {
            errors: [
              ['NOT_WHITELISTED_BY_USER_MESSAGE', 'that user only accepts messages from friends', null],
            ],
          },
        }),
      );

      const outcome = await worker.tick();
      expect(outcome.failed).toBe(1);

      const row = await readDelivery(deliveryId);
      expect(row.status).toBe('dead');
      expect(row.attempt).toBe(1);
      expect(row.nextAttemptAt).toBeNull();
      expect(row.error).toContain('NOT_WHITELISTED_BY_USER_MESSAGE');
    });

    it('retries a Reddit 5xx as ordinary transport flakiness', async () => {
      const conv = await seedConversation({}, 'ada_l');
      const deliveryId = await queueOutbound(conv.id, 'reddit is having a moment');
      http.on('/api/compose', () => jsonResponse({}, {}, 503));

      await worker.tick();
      const row = await readDelivery(deliveryId);
      expect(row.status).toBe('failed');
      expect(row.attempt).toBe(1);
      expect(row.nextAttemptAt).not.toBeNull();
    });

    it('paces sends with the stored per-hour default before the adapter is even called', async () => {
      const conv = await seedConversation({}, 'ada_l');
      for (let i = 0; i < DEFAULT_REDDIT_SEND_LIMITS.perHourMax!; i += 1) {
        const [msg] = await db
          .insert(schema.convMessages)
          .values({
            orgId,
            conversationId: conv.id,
            authorType: 'agent',
            authorId: 'agt_reddit',
            body: `already sent ${i}`,
          })
          .returning();
        await db.insert(schema.convMessageDeliveries).values({
          orgId,
          messageId: msg!.id,
          channelId,
          status: 'sent',
          attempt: 1,
          sentAt: new Date(Date.now() - 60_000),
        });
      }
      const deliveryId = await queueOutbound(conv.id, 'the fourth one this hour');

      const outcome = await worker.tick();
      expect(outcome.deferred).toBe(1);
      expect(http.calls('/api/compose')).toHaveLength(0);
      expect(parseRateLimitDeferral((await readDelivery(deliveryId)).error)?.reason).toBe('per_hour');
    });
  });

  describe('engagement refresh', () => {
    beforeEach(async () => {
      http.reset();
      client.setHttp(http);
      await clearConversations();
      await resetInboundState();
    });

    it('refreshes the score of comments we posted into the thread conversation metadata', async () => {
      const conv = await seedConversation({
        conversationKey: 'reddit:thread:abc123',
        redditTarget: 'comment',
      });
      const [msg] = await db
        .insert(schema.convMessages)
        .values({
          orgId,
          conversationId: conv.id,
          authorType: 'agent',
          authorId: 'agt_reddit',
          body: 'our comment',
        })
        .returning();
      await db.insert(schema.convMessageDeliveries).values({
        orgId,
        messageId: msg!.id,
        channelId,
        status: 'sent',
        attempt: 1,
        sentAt: new Date(),
        messageIdHeader: 't1_ours',
      });
      const [replier] = await db
        .insert(schema.convContacts)
        .values({ orgId, handle: 'grace_h' })
        .returning();
      await db.insert(schema.convMessages).values({
        orgId,
        conversationId: conv.id,
        authorType: 'end_user',
        authorId: replier!.id,
        body: 'agreed',
        metadata: { providerMessageId: 't1_reply', raw: { parentFullname: 't1_ours' } },
      });

      http.on('/message/unread', () => jsonResponse({ data: { children: [] } }));
      http.on('/api/info', () =>
        jsonResponse({ data: { children: [{ kind: 't1', data: { name: 't1_ours', score: 42 } }] } }),
      );
      await pollTick();

      const rows = await db
        .select()
        .from(schema.convConversations)
        .where(eq(schema.convConversations.id, conv.id));
      const engagement = rows[0]!.metadata.redditEngagement as
        | {
            comments?: Array<{
              fullname: string;
              score: number;
              removed: boolean;
              replyCount: number;
            }>;
          }
        | undefined;
      expect(engagement?.comments).toEqual([
        { fullname: 't1_ours', score: 42, removed: false, replyCount: 1 },
      ]);
      expect(http.calls('/api/info')).toHaveLength(1);
    });
  });

  describe('read tools', () => {
    beforeEach(() => {
      http.reset();
      client.setHttp(http);
    });

    it('returns a bounded search payload', async () => {
      http.on('/search', () =>
        jsonResponse({
          data: {
            children: [
              {
                kind: 't3',
                data: {
                  id: 'abc123',
                  name: 't3_abc123',
                  title: 'T'.repeat(500),
                  author: 'ada_l',
                  selftext: 'S'.repeat(2_000),
                  subreddit: 'devops',
                  permalink: '/r/devops/comments/abc123/x/',
                  score: 12,
                  num_comments: 3,
                  created_utc: 1_700_000_000,
                },
              },
            ],
          },
        }),
      );
      const res = await runAs(actor, () =>
        tools.searchThreads({ channelId, query: 'queue sizing', subreddit: 'r/devops' }),
      );
      expect(res.threads).toHaveLength(1);
      expect(res.threads[0]!.title.length).toBeLessThanOrEqual(301);
      expect(res.threads[0]!.excerpt.length).toBeLessThanOrEqual(501);
      expect(res.truncated.bodiesTruncated).toBe(1);
      expect(res.subreddit).toBe('devops');
    });

    it('returns a bounded thread payload with the depth cap reported', async () => {
      http.on('/comments/', () =>
        jsonResponse([
          {
            data: {
              children: [
                { kind: 't3', data: { id: 'abc123', name: 't3_abc123', title: 'X', selftext: '' } },
              ],
            },
          },
          {
            data: {
              children: [
                {
                  kind: 't1',
                  data: { id: 'c1', name: 't1_c1', author: 'grace_h', body: 'B'.repeat(1_000) },
                },
                { kind: 'more', data: { count: 30 } },
              ],
            },
          },
        ]),
      );
      const res = await runAs(actor, () =>
        tools.getThread({ channelId, threadId: 't3_abc123', commentLimit: 5, maxDepth: 1 }),
      );
      expect(res.post?.threadId).toBe('abc123');
      expect(res.comments[0]!.body.length).toBeLessThanOrEqual(701);
      expect(res.truncated.commentBodiesTruncated).toBe(1);
      expect(res.truncated.moreCommentsAvailable).toBe(true);
      expect(res.truncated.maxDepth).toBe(1);
    });

    it('returns the subreddit rules', async () => {
      http.on('/about/rules', () =>
        jsonResponse({
          rules: [{ kind: 'link', short_name: 'No spam', description: 'D'.repeat(1_000) }],
          site_rules: ['Spam'],
        }),
      );
      const res = await runAs(actor, () =>
        tools.getSubredditRules({ channelId, subreddit: 'r/devops' }),
      );
      expect(res.rules[0]!.shortName).toBe('No spam');
      expect(res.truncated.descriptionsTruncated).toBe(1);
      expect(res.siteRules).toEqual(['Spam']);
    });

    it('reports an unknown channel as not found rather than a 500', async () => {
      await expect(
        runAs(actor, () => tools.getSubredditRules({ channelId: 'cch_missing', subreddit: 'devops' })),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('reports a wrong-vendor channel as a bad request rather than a 500', async () => {
      const [other] = await db
        .insert(schema.convChannels)
        .values({ orgId, type: 'chat', vendor: 'munin', name: 'Widget' })
        .returning();
      await expect(
        runAs(actor, () => tools.getSubredditRules({ channelId: other!.id, subreddit: 'devops' })),
      ).rejects.toBeInstanceOf(BadRequestException);
      await db.delete(schema.convChannels).where(eq(schema.convChannels.id, other!.id));
    });

    it('turns a Reddit auth failure into a bad request rather than a 500', async () => {
      const isolated = new RedditClientService();
      const failing = new RouterHttp();
      failing.reset();
      failing.on('access_token', () => jsonResponse({}, {}, 401));
      isolated.setHttp(failing);
      const isolatedTools = new RedditAdminTools(reddit, isolated);
      await expect(
        runAs(actor, () => isolatedTools.getSubredditRules({ channelId, subreddit: 'devops' })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('tenant isolation', () => {
    it('hides another org channel from the reddit service', async () => {
      await expect(
        runAs(otherActor, () => reddit.requireChannel(channelId)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('hides another org channel row behind RLS', async () => {
      const rows = await appDb.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
        await tx.execute(sql`SELECT set_config('app.org_id', ${otherOrgId}, true)`);
        return tx
          .select({ id: schema.convChannels.id })
          .from(schema.convChannels)
          .where(eq(schema.convChannels.id, channelId));
      });
      expect(rows).toHaveLength(0);
    });

    it('refuses a cross-org update through RLS', async () => {
      const before = await loadChannelRow(channelId);
      await appDb.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
        await tx.execute(sql`SELECT set_config('app.org_id', ${otherOrgId}, true)`);
        await tx
          .update(schema.convChannels)
          .set({ name: 'hijacked' })
          .where(eq(schema.convChannels.id, channelId));
      });
      expect((await loadChannelRow(channelId)).name).toBe(before.name);
    });

    it('hides another org reddit conversations behind RLS', async () => {
      await clearConversations();
      const conv = await seedConversation({ conversationKey: 'reddit:thread:zzz999' });
      const rows = await appDb.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
        await tx.execute(sql`SELECT set_config('app.org_id', ${otherOrgId}, true)`);
        return tx
          .select({ id: schema.convConversations.id })
          .from(schema.convConversations)
          .where(
            and(
              eq(schema.convConversations.id, conv.id),
              eq(schema.convConversations.orgId, orgId),
            ),
          );
      });
      expect(rows).toHaveLength(0);
    });
  });
});
