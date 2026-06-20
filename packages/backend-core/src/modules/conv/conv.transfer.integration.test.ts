import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { buildApiKey, hashSecret, keyPrefix } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { AppModule } from '../../app.module.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run conv transfer integration tests.';

(skipReason ? describe.skip : describe)('Conv transfer: export org A → import org B via /mcp', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgAId: string;
  let orgBId: string;
  let adminKeyA: string;
  let adminKeyB: string;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';

    await runMigrations(TEST_URL!);
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const [orgA] = await db.insert(schema.orgs).values({ name: 'Conv Transfer Source Org' }).returning();
    const [orgB] = await db.insert(schema.orgs).values({ name: 'Conv Transfer Target Org' }).returning();
    orgAId = orgA!.id;
    orgBId = orgB!.id;

    adminKeyA = buildApiKey('admin');
    adminKeyB = buildApiKey('admin');
    await db.insert(schema.apiKeys).values([
      {
        orgId: orgAId,
        type: 'admin',
        name: 'conv-transfer-admin-a',
        keyHash: hashSecret(adminKeyA),
        keyPrefix: keyPrefix(adminKeyA),
        scopes: ['*'],
      },
      {
        orgId: orgBId,
        type: 'admin',
        name: 'conv-transfer-admin-b',
        keyHash: hashSecret(adminKeyB),
        keyPrefix: keyPrefix(adminKeyB),
        scopes: ['*'],
      },
    ]);

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
      await db.delete(schema.orgs).where(sql`id in (${orgAId}, ${orgBId})`);
    }
  });

  async function withClient<T>(token: string, fn: (c: Client) => Promise<T>): Promise<T> {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const c = new Client({ name: 'conv-transfer-it', version: '0.0.0' });
    await c.connect(transport);
    try {
      return await fn(c);
    } finally {
      await transport.close();
      await c.close();
    }
  }

  function firstJson(result: { content: Array<{ type: string; text?: string }> }): unknown {
    for (const item of result.content) {
      if (item.type === 'text' && typeof item.text === 'string') {
        try {
          return JSON.parse(item.text);
        } catch {
          return item.text;
        }
      }
    }
    return null;
  }

  interface ConvExportData {
    channels: Array<{ id: string; type: string; vendor: string; name: string; active: boolean }>;
    conversations: Array<{
      id: string;
      channelId: string;
      subject: string | null;
      status: string;
      topicSlug: string | null;
      agentMode: string;
    }>;
    messages: Array<{
      id: string;
      conversationId: string;
      authorType: string;
      authorId: string;
      body: string;
      internal: boolean;
      inReplyToId: string | null;
    }>;
  }
  interface ImportResult {
    created: number;
    updated: number;
    skipped: number;
    idMap: Record<string, string>;
    warnings: string[];
  }

  async function seedConversationInOrgA(channelId: string): Promise<{ convId: string; msgIds: string[] }> {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const next = await db.execute<{ next: number }>(sql`SELECT conv_next_display_id(${orgAId}) AS next`);
    const [conv] = await db
      .insert(schema.convConversations)
      .values({
        orgId: orgAId,
        displayId: next[0]!.next,
        channelId,
        subject: 'Where is my order?',
        status: 'open',
      })
      .returning();
    const [m1] = await db
      .insert(schema.convMessages)
      .values({
        orgId: orgAId,
        conversationId: conv!.id,
        authorType: 'end_user',
        authorId: 'eu_test',
        body: 'Hi, my package never arrived.',
        internal: false,
      })
      .returning();
    const [m2] = await db
      .insert(schema.convMessages)
      .values({
        orgId: orgAId,
        conversationId: conv!.id,
        authorType: 'agent',
        authorId: 'agent_test',
        body: 'Sorry to hear that — let me check the tracking.',
        internal: false,
        inReplyToId: m1!.id,
      })
      .returning();
    return { convId: conv!.id, msgIds: [m1!.id, m2!.id] };
  }

  it('moves channels + conversations + messages to a different org, remaps ids, redacts credentials', async () => {
    const channel = await withClient(adminKeyA, async (c) => {
      const res = await c.callTool({
        name: 'conv_create_channel',
        arguments: { type: 'chat', vendor: 'widget', name: 'Website widget' },
      });
      return firstJson(res as never) as { id: string };
    });

    await seedConversationInOrgA(channel.id);

    const exported = await withClient(adminKeyA, async (c) => {
      return firstJson((await c.callTool({ name: 'conv_export', arguments: {} })) as never) as ConvExportData;
    });

    expect(exported.channels.length).toBe(1);
    expect(exported.conversations.length).toBe(1);
    expect(exported.messages.length).toBe(2);
    const srcChannelId = exported.channels[0]!.id;
    const srcConvId = exported.conversations[0]!.id;
    const srcMsgIds = exported.messages.map((m) => m.id);

    const firstImport = await withClient(adminKeyB, async (c) => {
      const res = await c.callTool({ name: 'conv_import', arguments: { records: exported } });
      const result = firstJson(res as never) as ImportResult;
      const channels = firstJson(
        (await c.callTool({ name: 'conv_list_channels', arguments: {} })) as never,
      ) as Array<{ id: string; name: string; config: Record<string, unknown> }>;
      const conversations = firstJson(
        (await c.callTool({ name: 'conv_list_conversations', arguments: {} })) as never,
      ) as Array<{ id: string }>;
      return { result, channels, conversations };
    });

    expect(firstImport.result.created).toBe(4);
    expect(firstImport.result.idMap[srcChannelId]).toMatch(/^cch_/);
    expect(firstImport.result.idMap[srcChannelId]).not.toBe(srcChannelId);
    expect(firstImport.result.idMap[srcConvId]).toMatch(/^ccv_/);
    for (const id of srcMsgIds) {
      expect(firstImport.result.idMap[id]).toMatch(/^cvm_/);
    }
    expect(
      firstImport.result.warnings.some((w) => w.includes('without credentials')),
    ).toBe(true);
    const importedChannel = firstImport.channels.find((c) => c.name === 'Website widget');
    expect(importedChannel).toBeTruthy();
    expect(importedChannel!.config).toEqual({});
    expect(firstImport.conversations.length).toBe(1);

    const targetConvId = firstImport.result.idMap[srcConvId]!;
    const detail = await withClient(adminKeyB, async (c) => {
      return firstJson(
        (await c.callTool({ name: 'conv_get_conversation', arguments: { id: targetConvId } })) as never,
      ) as { messages: Array<{ id: string; inReplyToId: string | null }> };
    });
    expect(detail.messages.length).toBe(2);
    const reply = detail.messages.find((m) => m.id === firstImport.result.idMap[srcMsgIds[1]!]);
    expect(reply!.inReplyToId).toBe(firstImport.result.idMap[srcMsgIds[0]!]);

    const secondImport = await withClient(adminKeyB, async (c) => {
      const res = await c.callTool({
        name: 'conv_import',
        arguments: { records: exported, idMap: firstImport.result.idMap },
      });
      const result = firstJson(res as never) as ImportResult;
      const channels = firstJson(
        (await c.callTool({ name: 'conv_list_channels', arguments: {} })) as never,
      ) as Array<unknown>;
      const conversations = firstJson(
        (await c.callTool({ name: 'conv_list_conversations', arguments: {} })) as never,
      ) as Array<unknown>;
      return { result, channelCount: channels.length, convCount: conversations.length };
    });

    expect(secondImport.result.created).toBe(0);
    expect(secondImport.result.skipped).toBeGreaterThanOrEqual(2);
    expect(secondImport.channelCount).toBe(1);
    expect(secondImport.convCount).toBe(1);
  });
});
