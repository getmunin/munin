import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { buildApiKey, hashSecret, keyPrefix } from '@getmunin/core';
import type { StubMailer } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql, eq, and } from 'drizzle-orm';
import { AppModule } from '../../../app.module.ts';
import { EmailAdapter, type ImapFetcher } from './email-adapter.ts';
import { InboundPollWorker } from '../channels/inbound-poll.worker.ts';
import { OutboundDeliveryWorker } from '../channels/outbound-delivery.worker.ts';
import { MAILER } from '../../../common/mail/mail.module.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run email integration tests.';

const REPLY_DOMAIN = 'reply.example.test';

interface QueuedMessage {
  uid: number;
  source: string;
}

class StubImapFetcher implements ImapFetcher {
  readonly queue: QueuedMessage[] = [];

  push(source: string): number {
    const uid = (this.queue[this.queue.length - 1]?.uid ?? 0) + 1;
    this.queue.push({ uid, source });
    return uid;
  }

  fetchSince(opts: {
    sinceUid: number | null;
    limit: number;
  }): Promise<{ uid: number; source: Buffer | string }[]> {
    const since = opts.sinceUid ?? 0;
    const out = this.queue
      .filter((m) => m.uid > since)
      .slice(0, opts.limit)
      .map((m) => ({ uid: m.uid, source: m.source }));
    return Promise.resolve(out);
  }
}

(skipReason ? describe.skip : describe)('Email channel integration: SMTP send + IMAP poll + threading', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let adminKey: string;
  let inboundWorker: InboundPollWorker;
  let outboundWorker: OutboundDeliveryWorker;
  let emailAdapter: EmailAdapter;
  let mailer: StubMailer;
  let fetcher: StubImapFetcher;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_ENCRYPTION_KEY ??= 'integration-test-encryption-key';
    process.env.MUNIN_EMAIL_REPLY_DOMAIN = REPLY_DOMAIN;
    process.env.MUNIN_SSRF_ALLOW_PRIVATE = '1';

    await runMigrations(TEST_URL!);

    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'Email IT Org' })
      .returning();
    orgId = org!.id;

    adminKey = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId,
      type: 'admin',
      name: 'email-it-admin',
      keyHash: hashSecret(adminKey),
      keyPrefix: keyPrefix(adminKey),
      scopes: ['*'],
    });

    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    baseUrl = `http://127.0.0.1:${address.port}`;

    inboundWorker = app.get(InboundPollWorker);
    outboundWorker = app.get(OutboundDeliveryWorker);
    emailAdapter = app.get(EmailAdapter);
    mailer = app.get<StubMailer>(MAILER);
    fetcher = new StubImapFetcher();
    emailAdapter.setFetcher(fetcher);
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  beforeEach(() => {
    mailer.clear();
  });

  async function withClient<T>(token: string, fn: (c: Client) => Promise<T>): Promise<T> {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const c = new Client({ name: 'munin-email-it', version: '0.0.0' });
    await c.connect(transport);
    try {
      return await fn(c);
    } finally {
      await transport.close();
      await c.close();
    }
  }

  it('inbound from new sender → new conversation; admin reply → outbound via mailer with Reply-To plus-address; replied inbound threads back', async () => {
    // 1. Set up an email channel via the admin tool, then poll for the row to
    //    appear: MCP responses are written to the wire from inside the
    //    request transaction, so the client gets the response slightly before
    //    the transaction commits.
    const rawResult = await withClient(adminKey, async (c) =>
      c.callTool({
        name: 'conv_email_setup_channel',
        arguments: {
          name: 'Acme Support',
          config: {
            addressing: { fromAddress: 'support@acme.test', fromName: 'Acme Support' },
            outbound: { provider: 'mailer' },
            inbound: {
              provider: 'imap',
              host: 'imap.acme.test',
              port: 993,
              secure: true,
              username: 'support@acme.test',
              password: 'app-pw-stub',
              mailbox: 'INBOX',
            },
          },
        },
      }),
    );
    if ((rawResult as { isError?: boolean }).isError) {
      throw new Error(`conv_email_setup_channel failed: ${JSON.stringify(rawResult)}`);
    }
    const channel = parseToolResult<{ id: string; config: { addressing: { fromAddress: string } } }>(rawResult);
    expect(channel.config.addressing.fromAddress).toBe('support@acme.test');

    await waitFor(async () => {
      const rows = await db
        .select()
        .from(schema.convChannels)
        .where(eq(schema.convChannels.id, channel.id));
      return rows.length === 1;
    });

    const setupAudit = await db
      .select({ args: schema.auditLog.args })
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.orgId, orgId),
          eq(schema.auditLog.tool, 'conv_email_setup_channel'),
        ),
      );
    expect(setupAudit).toHaveLength(1);
    expect(JSON.stringify(setupAudit[0]!.args)).not.toContain('app-pw-stub');

    // 2. Push an inbound email from a brand-new sender.
    fetcher.push(rfc822({
      from: 'Customer One <c1@customer.test>',
      to: 'support@acme.test',
      subject: 'Help — login keeps failing',
      messageId: 'inbound-1@customer.test',
      body: 'I can\'t log in to my account. Can you help?',
    }));

    const ingest1 = await inboundWorker.tick();
    expect(ingest1.messagesIngested).toBe(1);

    // Worker created a contact + conversation on this channel.
    const conv1Rows = await db
      .select()
      .from(schema.convConversations)
      .where(eq(schema.convConversations.orgId, orgId));
    expect(conv1Rows).toHaveLength(1);
    const conv1 = conv1Rows[0]!;
    expect(conv1.channelId).toBe(channel.id);

    const contact1Rows = await db
      .select()
      .from(schema.convContacts)
      .where(and(eq(schema.convContacts.orgId, orgId), eq(schema.convContacts.email, 'c1@customer.test')));
    expect(contact1Rows).toHaveLength(1);

    // 3. Admin replies via conv_send_message → enqueues an outbound delivery.
    const adminMsgId = await withClient(adminKey, async (c) =>
      parseToolResult<{ id: string }>(
        await c.callTool({
          name: 'conv_send_message',
          arguments: {
            conversationId: conv1.id,
            body: 'Hi — I\'ve reset your password. Try logging in again.',
          },
        }),
      ),
    );

    await waitFor(async () => {
      const rows = await db
        .select()
        .from(schema.convMessageDeliveries)
        .where(eq(schema.convMessageDeliveries.messageId, adminMsgId.id));
      return rows.length === 1;
    });
    const queued = await db
      .select()
      .from(schema.convMessageDeliveries)
      .where(eq(schema.convMessageDeliveries.messageId, adminMsgId.id));
    expect(queued).toHaveLength(1);
    expect(queued[0]!.status).toBe('queued');

    // 4. Outbound worker drains the queue → StubMailer captures the message.
    const drain1 = await outboundWorker.tick();
    expect(drain1.sent).toBe(1);
    expect(mailer.outbox).toHaveLength(1);
    const sent1 = mailer.outbox[0]!;
    expect(sent1.to).toBe('c1@customer.test');
    expect(sent1.from).toContain('support@acme.test');
    expect(sent1.text).toContain('reset your password');
    // Headers include the Message-ID we stamped, and Reply-To is the auto plus-address.
    const stampedMessageId = sent1.headers?.['Message-ID'];
    expect(stampedMessageId).toMatch(/^<[^<>]+@acme\.test>$/);
    // ResendMailer composes Reply-To from msg.replyTo (set via composeReplyToBare for mailer path).
    // The ‘mailer’ codepath uses replyToTemplate only — undefined here. The stamped
    // Message-ID is what the inbound side will key off when the customer replies.

    // Delivery row is now 'sent' with the stamped Message-ID persisted for threading.
    const sentRow = (
      await db
        .select()
        .from(schema.convMessageDeliveries)
        .where(eq(schema.convMessageDeliveries.messageId, adminMsgId.id))
    )[0]!;
    expect(sentRow.status).toBe('sent');
    expect(sentRow.messageIdHeader).toBeTruthy();

    // 5. Customer replies — the inbound carries In-Reply-To matching our stamped Message-ID.
    fetcher.push(rfc822({
      from: 'Customer One <c1@customer.test>',
      to: 'support@acme.test',
      subject: 'Re: Help — login keeps failing',
      messageId: 'inbound-2@customer.test',
      inReplyTo: sentRow.messageIdHeader!,
      references: [sentRow.messageIdHeader!],
      body: 'That worked, thanks!',
    }));

    const ingest2 = await inboundWorker.tick();
    expect(ingest2.messagesIngested).toBe(1);

    // Threaded into the existing conversation (no new conversation row).
    const allConvs = await db
      .select()
      .from(schema.convConversations)
      .where(eq(schema.convConversations.orgId, orgId));
    expect(allConvs).toHaveLength(1);
    const messages = await db
      .select()
      .from(schema.convMessages)
      .where(eq(schema.convMessages.conversationId, conv1.id));
    // 1 inbound + 1 admin reply + 1 inbound reply = 3
    expect(messages).toHaveLength(3);
    expect(messages.some((m) => m.body.includes('That worked'))).toBe(true);
  }, 60_000);

  it('inbound to plus-addressed Reply-To resolves to the conversation even without In-Reply-To', async () => {
    const conv = (
      await db
        .select()
        .from(schema.convConversations)
        .where(eq(schema.convConversations.orgId, orgId))
    )[0]!;

    fetcher.push(rfc822({
      from: 'Customer One <c1@customer.test>',
      to: `support+conv-${conv.id}@${REPLY_DOMAIN}`,
      subject: 'New angle, no headers',
      messageId: 'inbound-plus-1@customer.test',
      body: 'Plus-addressed reply, no In-Reply-To.',
    }));

    const ingested = await inboundWorker.tick();
    expect(ingested.messagesIngested).toBe(1);

    const messages = await db
      .select()
      .from(schema.convMessages)
      .where(eq(schema.convMessages.conversationId, conv.id));
    expect(messages.some((m) => m.body.includes('Plus-addressed reply'))).toBe(true);
  }, 30_000);

  it('5 consecutive poll failures auto-deactivate the channel and flag the alert', async () => {
    const channel = (
      await db
        .select()
        .from(schema.convChannels)
        .where(eq(schema.convChannels.orgId, orgId))
    )[0]!;

    const original = emailAdapter['fetcher'];
    const throwing: ImapFetcher = {
      fetchSince: () => Promise.reject(new Error('Command failed')),
    };
    emailAdapter.setFetcher(throwing);

    try {
      for (let i = 0; i < 5; i++) {
        await inboundWorker.tick();
      }
    } finally {
      emailAdapter.setFetcher(original);
    }

    const refreshed = (
      await db
        .select()
        .from(schema.convChannels)
        .where(eq(schema.convChannels.id, channel.id))
    )[0]!;
    expect(refreshed.active).toBe(false);

    const alerts = await db
      .select()
      .from(schema.orgAlerts)
      .where(
        and(eq(schema.orgAlerts.orgId, orgId), eq(schema.orgAlerts.subjectId, channel.id)),
      );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.occurrenceCount).toBe(5);
    expect((alerts[0]!.metadata as { deactivatedAt?: string }).deactivatedAt).toBeDefined();

    await db
      .update(schema.convChannels)
      .set({ active: true })
      .where(eq(schema.convChannels.id, channel.id));
    await db
      .update(schema.orgAlerts)
      .set({ resolvedAt: new Date() })
      .where(eq(schema.orgAlerts.id, alerts[0]!.id));
  }, 30_000);

  it('inbound from a fresh sender opens a new conversation + new contact', async () => {
    const before = await db
      .select()
      .from(schema.convConversations)
      .where(eq(schema.convConversations.orgId, orgId));

    fetcher.push(rfc822({
      from: 'Brand New <newcomer@elsewhere.test>',
      to: 'support@acme.test',
      subject: 'Hi, first time emailing',
      messageId: 'inbound-newcomer@elsewhere.test',
      body: 'I have a sales question.',
    }));

    const ingested = await inboundWorker.tick();
    expect(ingested.messagesIngested).toBe(1);

    const after = await db
      .select()
      .from(schema.convConversations)
      .where(eq(schema.convConversations.orgId, orgId));
    expect(after.length).toBe(before.length + 1);

    const newcomer = await db
      .select()
      .from(schema.convContacts)
      .where(and(eq(schema.convContacts.orgId, orgId), eq(schema.convContacts.email, 'newcomer@elsewhere.test')));
    expect(newcomer).toHaveLength(1);
  }, 30_000);
});

async function waitFor(check: () => Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`waitFor timeout after ${timeoutMs}ms`);
}

function parseToolResult<T>(result: unknown): T {
  const r = result as { content?: Array<{ type: string; text?: string }> };
  const text = r.content?.[0]?.text ?? '';
  return JSON.parse(text) as T;
}

function rfc822(input: {
  from: string;
  to: string;
  subject: string;
  messageId: string;
  inReplyTo?: string;
  references?: string[];
  body: string;
}): string {
  const lines = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${input.messageId}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: 7bit',
  ];
  if (input.inReplyTo) lines.push(`In-Reply-To: <${input.inReplyTo}>`);
  if (input.references?.length) {
    lines.push(`References: ${input.references.map((r) => `<${r}>`).join(' ')}`);
  }
  return `${lines.join('\r\n')}\r\n\r\n${input.body}\r\n`;
}
