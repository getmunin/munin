import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { buildApiKey, hashSecret, keyPrefix } from '@getmunin/core';
import type { StubMailer } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql, eq } from 'drizzle-orm';
import { AppModule } from '../../../app.module.ts';
import { MAILER } from '../../../common/mail/mail.module.ts';
import { OutboundDeliveryWorker } from '../channels/outbound-delivery.worker.ts';
import { EmailAdapter } from './email-adapter.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run shared-sender integration tests.';

const DEPLOYMENT_FROM = 'Munin <no-reply@munin.example.test>';
const MANAGED_ENV = [
  'MUNIN_MAIL_FROM',
  'MUNIN_MAIL_ORG_FROM_DOMAINS',
  'MUNIN_EMAIL_REPLY_DOMAIN',
] as const;

interface ConfiguredChannel {
  id: string;
  active: boolean;
  effectiveSender: { from: string; usesDeploymentSender: boolean; note?: string };
}

(skipReason ? describe.skip : describe)('Email channels on the shared mailer', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let adminKey: string;
  let mailer: StubMailer;
  let outboundWorker: OutboundDeliveryWorker;
  let emailAdapter: EmailAdapter;
  const savedEnv = new Map<string, string | undefined>();

  beforeAll(async () => {
    for (const name of MANAGED_ENV) savedEnv.set(name, process.env[name]);
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_ENCRYPTION_KEY ??= 'integration-test-encryption-key';
    process.env.MUNIN_MAIL_FROM = DEPLOYMENT_FROM;
    delete process.env.MUNIN_MAIL_ORG_FROM_DOMAINS;
    delete process.env.MUNIN_EMAIL_REPLY_DOMAIN;

    await runMigrations(TEST_URL!);

    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const [org] = await db.insert(schema.orgs).values({ name: 'Shared sender IT' }).returning();
    orgId = org!.id;

    adminKey = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId,
      type: 'admin',
      name: 'shared-sender-it-admin',
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

    mailer = app.get<StubMailer>(MAILER);
    outboundWorker = app.get(OutboundDeliveryWorker);
    emailAdapter = app.get(EmailAdapter);
  });

  afterAll(async () => {
    for (const [name, value] of savedEnv) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    if (app) await app.close();
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  beforeEach(() => {
    mailer.clear();
    delete process.env.MUNIN_MAIL_ORG_FROM_DOMAINS;
  });

  async function callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${adminKey}` } },
    });
    const client = new Client({ name: 'munin-shared-sender-it', version: '0.0.0' });
    await client.connect(transport);
    try {
      const result = (await client.callTool({ name, arguments: args })) as {
        isError?: boolean;
        content?: Array<{ type: string; text?: string }>;
      };
      if (result.isError) throw new Error(`${name} failed: ${JSON.stringify(result)}`);
      return JSON.parse(result.content?.[0]?.text ?? '') as T;
    } finally {
      await transport.close();
      await client.close();
    }
  }

  function configureMailerChannel(
    addressing: Record<string, string>,
  ): Promise<ConfiguredChannel> {
    return callTool<ConfiguredChannel>('conv_configure_email_channel', {
      name: `Mailer ${addressing.fromAddress}`,
      config: { addressing, outbound: { provider: 'mailer' } },
    });
  }

  async function deliverReply(channelId: string): Promise<{
    conversationId: string;
    sent: StubMailer['outbox'][number];
  }> {
    const [contact] = await db
      .insert(schema.convContacts)
      .values({ orgId, email: `customer-${Date.now()}@customer.example.test`, name: 'Kari Nordmann' })
      .returning();
    const rows = await db.execute<{ next: number } & Record<string, unknown>>(
      sql`SELECT conv_next_display_id(${orgId}) AS next`,
    );
    const list = Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? []);
    const [conv] = await db
      .insert(schema.convConversations)
      .values({
        orgId,
        channelId,
        contactId: contact!.id,
        displayId: (list[0] as { next: number }).next,
        subject: 'Order question',
        lastMessageAt: new Date(),
      })
      .returning();
    const [msg] = await db
      .insert(schema.convMessages)
      .values({
        orgId,
        conversationId: conv!.id,
        authorType: 'user',
        authorId: 'user:test',
        body: 'Thanks for writing in.',
        internal: false,
        metadata: {},
      })
      .returning();
    await db.insert(schema.convMessageDeliveries).values({
      orgId,
      messageId: msg!.id,
      channelId,
      status: 'queued',
      attempt: 0,
      nextAttemptAt: new Date(),
    });
    mailer.clear();
    await outboundWorker.tick();
    const sent = mailer.outbox.find((m) => m.to === contact!.email);
    if (!sent) throw new Error('reply was not delivered');
    return { conversationId: conv!.id, sent };
  }

  async function channelRow(id: string) {
    const [row] = await db.select().from(schema.convChannels).where(eq(schema.convChannels.id, id));
    return row!;
  }

  it('sends from the deployment sender with the channel name and Reply-To when no org domain is allowed', async () => {
    const channel = await configureMailerChannel({
      fromAddress: 'support@acme.example.test',
      fromName: 'Acme Support',
    });
    expect(channel.active).toBe(true);
    expect(channel.effectiveSender.from).toBe('Acme Support <no-reply@munin.example.test>');
    expect(channel.effectiveSender.usesDeploymentSender).toBe(true);
    expect(channel.effectiveSender.note).toContain('support@acme.example.test');

    const { sent } = await deliverReply(channel.id);
    expect(sent.from).toBe('Acme Support <no-reply@munin.example.test>');
    expect(sent.replyTo).toBe('support@acme.example.test');
    expect(sent.headers?.['Message-ID']).toMatch(/^<[^<>]+@munin\.example\.test>$/);
  });

  it('refuses to send as an address on the deployment domain itself', async () => {
    process.env.MUNIN_MAIL_ORG_FROM_DOMAINS = 'acme.example.test';
    const channel = await configureMailerChannel({
      fromAddress: 'security@munin.example.test',
      fromName: 'Security',
    });
    expect(channel.effectiveSender.usesDeploymentSender).toBe(true);

    const { sent } = await deliverReply(channel.id);
    expect(sent.from).toBe('Security <no-reply@munin.example.test>');
    expect(sent.from).not.toContain('security@');
  });

  it('sends as the configured address when its domain is allowed', async () => {
    process.env.MUNIN_MAIL_ORG_FROM_DOMAINS = 'ACME.example.test, globex.example.test';
    const channel = await configureMailerChannel({
      fromAddress: 'support@acme.example.test',
      fromName: 'Acme Support',
    });
    expect(channel.effectiveSender).toEqual({
      from: 'Acme Support <support@acme.example.test>',
      usesDeploymentSender: false,
    });

    const { sent } = await deliverReply(channel.id);
    expect(sent.from).toBe('Acme Support <support@acme.example.test>');
    expect(sent.replyTo).toBeUndefined();
    expect(sent.headers?.['Message-ID']).toMatch(/^<[^<>]+@acme\.example\.test>$/);
  });

  it('allows any address with *', async () => {
    process.env.MUNIN_MAIL_ORG_FROM_DOMAINS = '*';
    const channel = await configureMailerChannel({
      fromAddress: 'help@initech.example.test',
      fromName: 'Initech Help',
    });
    expect(channel.effectiveSender.usesDeploymentSender).toBe(false);

    const { sent } = await deliverReply(channel.id);
    expect(sent.from).toBe('Initech Help <help@initech.example.test>');
  });

  it('keeps a Reply-To template ahead of the fallback and fills in the conversation id', async () => {
    const channel = await configureMailerChannel({
      fromAddress: 'support@acme.example.test',
      fromName: 'Acme Support',
      replyToTemplate: 'support+conv-{conversationId}@acme.example.test',
    });

    const { conversationId, sent } = await deliverReply(channel.id);
    expect(sent.from).toBe('Acme Support <no-reply@munin.example.test>');
    expect(sent.replyTo).toBe(`support+conv-${conversationId}@acme.example.test`);
  });

  it('applies the same sender to bulk sends', async () => {
    const channel = await configureMailerChannel({
      fromAddress: 'news@acme.example.test',
      fromName: 'Acme News',
    });
    const row = await channelRow(channel.id);
    const [result] = await emailAdapter.sendBulk(row, [
      {
        key: 'r1',
        to: 'reader@customer.example.test',
        subject: 'Spring update',
        html: '<p>Hello</p>',
        text: 'Hello',
        replyKey: 'rk1',
      },
    ]);
    expect(result!.error).toBeNull();
    const sent = mailer.outbox[0]!;
    expect(sent.from).toBe('Acme News <no-reply@munin.example.test>');
    expect(sent.replyTo).toBe('news@acme.example.test');
    expect(result!.messageId).toMatch(/@munin\.example\.test$/);
  });

  it('applies the same sender to a channel test email', async () => {
    const channel = await configureMailerChannel({
      fromAddress: 'support@acme.example.test',
      fromName: 'Acme Support',
    });
    await callTool('conv_send_email_channel_test', {
      channelId: channel.id,
      to: 'operator@customer.example.test',
    });
    const sent = mailer.outbox[0]!;
    expect(sent.from).toBe('Acme Support <no-reply@munin.example.test>');
    expect(sent.replyTo).toBe('support@acme.example.test');
  });
});
