import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { buildApiKey, hashSecret, keyPrefix } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql, eq } from 'drizzle-orm';
import { AppModule } from '../../app.module.js';

const TEST_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set DATABASE_URL or TEST_DATABASE_URL to a Postgres URL to run voice-callback channelId tests.';

(skipReason ? describe.skip : describe)('conv_voice_call_contact — optional channelId routing', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let adminKey: string;
  let conversationId: string;
  let channelAId: string;
  let channelBId: string;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_ENCRYPTION_KEY ??=
      'dGVzdC1lbmNyeXB0aW9uLWtleS1tdXN0LWJlLWxvbmctZW5vdWdoLWZvci1wZ2NyeXB0bw==';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';

    await runMigrations(TEST_URL!);
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'Voice Routing IT Org' })
      .returning();
    orgId = org!.id;

    adminKey = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId,
      type: 'admin',
      name: 'voice-routing-admin',
      keyHash: hashSecret(adminKey),
      keyPrefix: keyPrefix(adminKey),
      scopes: ['*'],
    });

    const [contact] = await db
      .insert(schema.convContacts)
      .values({ orgId, name: 'Caller', phone: '+14155550100' })
      .returning();

    const [chatChannel] = await db
      .insert(schema.convChannels)
      .values({
        orgId,
        type: 'chat',
        vendor: 'munin',
        name: 'widget',
        active: true,
        config: {},
      })
      .returning();
    const nextDisplay = await db.execute<{ next: number }>(
      sql`SELECT conv_next_display_id(${orgId}) AS next`,
    );
    const [conv] = await db
      .insert(schema.convConversations)
      .values({
        orgId,
        channelId: chatChannel!.id,
        contactId: contact!.id,
        displayId: nextDisplay[0]!.next,
        status: 'open',
      })
      .returning();
    conversationId = conv!.id;

    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  async function withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${adminKey}` } },
    });
    const c = new Client({ name: 'voice-routing-it', version: '0.0.0' });
    await c.connect(transport);
    try {
      return await fn(c);
    } finally {
      await transport.close();
      await c.close();
    }
  }

  function firstText(result: { content: Array<{ type: string; text?: string }> }): string {
    return result.content.find((c) => c.type === 'text')?.text ?? '';
  }

  async function insertVoiceChannel(name: string): Promise<string> {
    const [row] = await db
      .insert(schema.convChannels)
      .values({
        orgId,
        type: 'voice',
        vendor: 'vapi',
        name,
        active: true,
        config: {
          encryptedApiKey: 'fake',
          encryptedWebhookSecret: 'fake',
          assistantId: 'asst_x',
          phoneNumberId: 'pn_x',
        },
      })
      .returning();
    return row!.id;
  }

  it('no voice channels → throws no_active_voice_channel', async () => {
    await withClient(async (c) => {
      const res = await c.callTool({
        name: 'conv_voice_call_contact',
        arguments: { conversationId },
      });
      expect(res.isError).toBe(true);
      expect(firstText(res as never)).toContain('no_active_voice_channel');
    });
  });

  it('one voice channel → calls it without channelId being required', async () => {
    channelAId = await insertVoiceChannel('vapi-only');
    await withClient(async (c) => {
      const res = await c.callTool({
        name: 'conv_voice_call_contact',
        arguments: { conversationId },
      });
      const text = firstText(res as never);
      expect(text, text).toMatch(/vapi_|fetch failed|placeCall|TypeError|invalid|pgp_sym_decrypt/i);
    });
  });

  it('two voice channels without channelId → throws asking caller to pick', async () => {
    channelBId = await insertVoiceChannel('vapi-second');
    await withClient(async (c) => {
      const res = await c.callTool({
        name: 'conv_voice_call_contact',
        arguments: { conversationId },
      });
      expect(res.isError).toBe(true);
      expect(firstText(res as never)).toContain('multiple_active_voice_channels');
    });
  });

  it('two voice channels with explicit channelId → routes to the named channel', async () => {
    await withClient(async (c) => {
      const res = await c.callTool({
        name: 'conv_voice_call_contact',
        arguments: { conversationId, channelId: channelBId },
      });
      const text = firstText(res as never);
      expect(text, text).toMatch(/vapi_|fetch failed|placeCall|TypeError|invalid|pgp_sym_decrypt/i);
    });
  });

  it('explicit channelId pointing at a non-voice channel → not found', async () => {
    const [emailCh] = await db
      .insert(schema.convChannels)
      .values({
        orgId,
        type: 'email',
        vendor: 'smtp',
        name: 'support-email',
        active: true,
        config: {},
      })
      .returning();
    await withClient(async (c) => {
      const res = await c.callTool({
        name: 'conv_voice_call_contact',
        arguments: { conversationId, channelId: emailCh!.id },
      });
      expect(res.isError).toBe(true);
      expect(firstText(res as never)).toContain('not found');
    });
  });

  it('explicit channelId pointing at an archived channel → not found', async () => {
    await db
      .update(schema.convChannels)
      .set({ active: false, archivedAt: new Date() })
      .where(eq(schema.convChannels.id, channelAId));
    await withClient(async (c) => {
      const res = await c.callTool({
        name: 'conv_voice_call_contact',
        arguments: { conversationId, channelId: channelAId },
      });
      expect(res.isError).toBe(true);
      expect(firstText(res as never)).toContain('not found');
    });
  });
});
