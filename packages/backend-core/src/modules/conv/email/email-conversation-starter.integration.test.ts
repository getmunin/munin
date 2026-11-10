import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import {
  ActorIdentity,
  RequestContextStore,
  buildApiKey,
  hashSecret,
  keyPrefix,
  type ActorType,
  type RequestContext,
} from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { and, eq, sql } from 'drizzle-orm';
import { AppModule } from '../../../app.module.ts';
import { ConvService } from '../conv.service.ts';
import { EmailConversationStarter } from './email-conversation-starter.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to run email conversation start integration tests.';

(skipReason ? describe.skip : describe)('starting an email conversation', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let conv: ConvService;
  let starter: EmailConversationStarter;
  let orgId: string;
  let userId: string;
  let adminKey: string;
  let emailChannelId: string;
  let chatChannelId: string;

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

    const [org] = await db.insert(schema.orgs).values({ name: 'Email Start Org' }).returning();
    orgId = org!.id;

    const [user] = await db
      .insert(schema.users)
      .values({ email: `email-start-${randomUUID()}@example.com`, name: 'Kari Nordmann' })
      .returning();
    userId = user!.id;

    adminKey = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId,
      type: 'admin',
      name: 'email-start-admin',
      keyHash: hashSecret(adminKey),
      keyPrefix: keyPrefix(adminKey),
      scopes: ['*'],
    });

    const [email] = await db
      .insert(schema.convChannels)
      .values({
        orgId,
        type: 'email',
        vendor: 'smtp',
        name: 'support',
        active: true,
        config: { addressing: { fromAddress: 'support@example.com' } },
      })
      .returning();
    emailChannelId = email!.id;

    const [chat] = await db
      .insert(schema.convChannels)
      .values({
        orgId,
        type: 'chat',
        vendor: 'munin',
        name: 'chat',
        config: { provider: 'widget', originAllowlist: [] },
      })
      .returning();
    chatChannelId = chat!.id;

    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    baseUrl = `http://127.0.0.1:${address.port}`;
    conv = app.get(ConvService);
    starter = app.get(EmailConversationStarter);
  });

  afterAll(async () => {
    await app?.close();
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId));
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
  });

  beforeEach(async () => {
    await db
      .update(schema.convChannels)
      .set({ active: true })
      .where(eq(schema.convChannels.id, emailChannelId));
  });

  async function as<T>(type: ActorType, fn: () => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
      await tx.execute(sql`SELECT set_config('app.end_user_id', '', true)`);
      const actor =
        type === 'user'
          ? new ActorIdentity('user', userId, orgId, ['*'], ['admin'], undefined, undefined, undefined, userId)
          : new ActorIdentity(type, 'email-start-agent', orgId, ['*'], ['admin']);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      return RequestContextStore.run(ctx, fn);
    });
  }

  async function deliveriesFor(conversationId: string) {
    return db
      .select({ id: schema.convMessageDeliveries.id })
      .from(schema.convMessageDeliveries)
      .innerJoin(schema.convMessages, eq(schema.convMessages.id, schema.convMessageDeliveries.messageId))
      .where(eq(schema.convMessages.conversationId, conversationId));
  }

  it('sends a message a signed-in person starts, as a new thread to a new contact', async () => {
    const address = `ola-${randomUUID()}@example.com`;
    const started = await as('user', () =>
      starter.start({
        email: address.toUpperCase(),
        name: 'Ola Nordmann',
        subject: 'Your order',
        body: 'Hi Ola, a quick note about your order.',
      }),
    );

    expect(started.delivery).toBe('queued');
    expect(started.conversation.subject).toBe('Your order');
    expect(started.conversation.channelId).toBe(emailChannelId);
    const [message] = started.conversation.messages;
    expect(message).toMatchObject({ authorType: 'user', authorId: userId, internal: false });
    expect(await deliveriesFor(started.conversation.id)).toHaveLength(1);

    const [contact] = await db
      .select()
      .from(schema.convContacts)
      .where(and(eq(schema.convContacts.orgId, orgId), eq(schema.convContacts.email, address)));
    expect(contact).toMatchObject({ name: 'Ola Nordmann' });
    expect(contact!.endUserId).toBeTruthy();
    expect(started.conversation.contactId).toBe(contact!.id);
  });

  it('reuses the existing contact for an address', async () => {
    const address = `kari-${randomUUID()}@example.com`;
    const first = await as('user', () =>
      starter.start({ email: address, subject: 'One', body: 'First.' }),
    );
    const second = await as('user', () =>
      starter.start({ email: address.toUpperCase(), subject: 'Two', body: 'Second.' }),
    );
    expect(second.conversation.id).not.toBe(first.conversation.id);
    expect(second.conversation.contactId).toBe(first.conversation.contactId);
  });

  it('parks an agent-started message as a draft that goes out only once a person approves it', async () => {
    const address = `agent-${randomUUID()}@example.com`;
    const started = await as('admin_agent', () =>
      starter.start({ email: address, subject: 'Following up', body: 'Hello from the agent.' }),
    );

    expect(started.delivery).toBe('awaiting_approval');
    const [draft] = started.conversation.messages;
    expect(started.conversation.messages).toHaveLength(1);
    expect(draft).toMatchObject({ authorType: 'agent', internal: true, body: 'Hello from the agent.' });
    expect(draft!.metadata).toMatchObject({ kind: 'draft_reply' });
    expect(await deliveriesFor(started.conversation.id)).toHaveLength(0);

    await as('user', () =>
      conv.sendMessage({
        conversationId: started.conversation.id,
        body: 'Hello from the agent.',
        fromDraftId: draft!.id,
        authorType: 'user',
        authorId: userId,
      }),
    );
    expect(await deliveriesFor(started.conversation.id)).toHaveLength(1);
  });

  it('refuses an address whose CRM contact is marked do-not-contact', async () => {
    const address = `dnc-${randomUUID()}@example.com`;
    await db.insert(schema.crmContacts).values({ orgId, email: address, doNotContact: true });
    await expect(
      as('user', () => starter.start({ email: address, subject: 'Hi', body: 'Hello.' })),
    ).rejects.toThrow(/do-not-contact/);
  });

  it('refuses an address whose mail is known to bounce', async () => {
    const address = `bounce-${randomUUID()}@example.com`;
    await db.insert(schema.crmAddressDeliverability).values({
      orgId,
      address,
      state: 'undeliverable',
      reason: 'hard_bounce',
      failureCount: 1,
    });
    await expect(
      as('user', () => starter.start({ email: address, subject: 'Hi', body: 'Hello.' })),
    ).rejects.toThrow(/mail cannot reach/);
  });

  it('rejects a channel that is not email, inactive, or unknown', async () => {
    const email = `chan-${randomUUID()}@example.com`;
    await expect(
      as('user', () => starter.start({ email, subject: 'Hi', body: 'Hello.', channelId: chatChannelId })),
    ).rejects.toThrow(/not an email channel/);
    await expect(
      as('user', () => starter.start({ email, subject: 'Hi', body: 'Hello.', channelId: 'cch_missing' })),
    ).rejects.toThrow(/conv_not_found/);

    await db
      .update(schema.convChannels)
      .set({ active: false })
      .where(eq(schema.convChannels.id, emailChannelId));
    await expect(
      as('user', () => starter.start({ email, subject: 'Hi', body: 'Hello.', channelId: emailChannelId })),
    ).rejects.toThrow(/not active/);
    await expect(
      as('user', () => starter.start({ email, subject: 'Hi', body: 'Hello.' })),
    ).rejects.toThrow(/no active email channel/);
  });

  it('asks for a channel when more than one email channel could send', async () => {
    const [second] = await db
      .insert(schema.convChannels)
      .values({
        orgId,
        type: 'email',
        vendor: 'smtp',
        name: 'sales',
        active: true,
        config: { addressing: { fromAddress: 'sales@example.com' } },
      })
      .returning();
    try {
      const email = `multi-${randomUUID()}@example.com`;
      await expect(
        as('user', () => starter.start({ email, subject: 'Hi', body: 'Hello.' })),
      ).rejects.toThrow(/more than one active email channel/);
      const started = await as('user', () =>
        starter.start({ email, subject: 'Hi', body: 'Hello.', channelId: second!.id }),
      );
      expect(started.conversation.channelId).toBe(second!.id);
    } finally {
      await db
        .update(schema.convChannels)
        .set({ archivedAt: new Date() })
        .where(eq(schema.convChannels.id, second!.id));
    }
  });

  it('rejects an unknown topic before creating anything', async () => {
    const email = `topic-${randomUUID()}@example.com`;
    await expect(
      as('user', () => starter.start({ email, subject: 'Hi', body: 'Hello.', topicId: 'ctp_missing' })),
    ).rejects.toThrow(/conv_not_found: topic/);
    const contacts = await db
      .select({ id: schema.convContacts.id })
      .from(schema.convContacts)
      .where(eq(schema.convContacts.email, email));
    expect(contacts).toHaveLength(0);
  });

  it('serves the tool over /mcp to an admin key as a draft, and returns refusals as tool errors', async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${adminKey}` } },
    });
    const client = new Client({ name: 'munin-it', version: '0.0.0' });
    await client.connect(transport);
    try {
      const ok = await client.callTool({
        name: 'conv_start_email_conversation',
        arguments: { email: `mcp-${randomUUID()}@example.com`, subject: 'Hi', body: 'Hello.' },
      });
      expect(ok.isError).toBeFalsy();
      const okText = (ok.content as Array<{ type: string; text: string }>)[0]!.text;
      expect(JSON.parse(okText)).toMatchObject({ delivery: 'awaiting_approval' });

      const refused = await client.callTool({
        name: 'conv_start_email_conversation',
        arguments: {
          email: `mcp-${randomUUID()}@example.com`,
          subject: 'Hi',
          body: 'Hello.',
          channelId: chatChannelId,
        },
      });
      expect(refused.isError).toBe(true);
      const refusedText = (refused.content as Array<{ type: string; text: string }>)[0]!.text;
      expect(refusedText).toMatch(/not an email channel/);
    } finally {
      await transport.close();
      await client.close();
    }
  });

  it('serves POST /v1/conversations/email to an admin key', async () => {
    const res = await fetch(`${baseUrl}/v1/conversations/email`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `rest-${randomUUID()}@example.com`, subject: 'Hi', body: 'Hello.' }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ delivery: 'awaiting_approval' });

    const bad = await fetch(`${baseUrl}/v1/conversations/email`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `rest-${randomUUID()}@example.com`,
        subject: 'Hi',
        body: 'Hello.',
        channelId: chatChannelId,
      }),
    });
    expect(bad.status).toBe(400);
  });
});
