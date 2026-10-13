import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { AddressInfo } from 'node:net';
import {
  RequestContextStore,
  buildApiKey,
  buildEndUserAgentActor,
  hashSecret,
  keyPrefix,
} from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { AppModule } from '../../../app.module.ts';
import { createApp } from '../../../bootstrap-app.ts';
import { McpRegistryService } from '../../../mcp/mcp.registry.ts';
import { openEndUserAgentMcpClient } from '../../../agent/in-process-context.ts';
import { applyTenancyGUCs } from '../../../common/tenancy/tenancy.interceptor.ts';
import { ConnectorsService } from '../../connectors/connectors.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run channel sources integration tests.';

interface ToolResult {
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
}

function textOf(result: ToolResult): string {
  return result.content.find((c) => c.type === 'text')?.text ?? '';
}

(skipReason ? describe.skip : describe)('Channel sources', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let orgId: string;
  let adminKey: string;
  let acmeChannelId: string;
  let globexChannelId: string;
  let acmeSpaceId: string;
  let globexSpaceId: string;
  let acmeDocId: string;
  let globexDocId: string;
  let acmeConnectionId: string;
  let globexConnectionId: string;
  let seoConnectionId: string;
  let endUserId: string;
  let acmeConversationId: string;
  let globexConversationId: string;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod-it-must-be-32-chars';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_ENCRYPTION_KEY ??= 'integration-test-encryption-key';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
    process.env.MUNIN_CMS_SCHEDULE_WORKER_DISABLED = '1';

    await runMigrations(TEST_URL!);
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;
    appDb = createDb(appUrl);

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const [org] = await db.insert(schema.orgs).values({ name: 'Channel Sources IT Org' }).returning();
    orgId = org!.id;

    adminKey = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId,
      type: 'admin',
      name: 'channel-sources-it-admin',
      keyHash: hashSecret(adminKey),
      keyPrefix: keyPrefix(adminKey),
      scopes: ['*'],
    });

    const channels = await db
      .insert(schema.convChannels)
      .values([
        { orgId, type: 'chat', vendor: 'munin', name: 'Acme chat' },
        { orgId, type: 'chat', vendor: 'munin', name: 'Globex chat' },
      ])
      .returning();
    acmeChannelId = channels[0]!.id;
    globexChannelId = channels[1]!.id;

    const connections = await db
      .insert(schema.connectorConnections)
      .values([
        { orgId, vendor: 'magento', domain: 'commerce', name: 'Acme store', config: {} },
        { orgId, vendor: 'magento', domain: 'commerce', name: 'Globex store', config: {} },
        { orgId, vendor: 'bing', domain: 'seo', name: 'Bing', config: {} },
      ])
      .returning();
    acmeConnectionId = connections[0]!.id;
    globexConnectionId = connections[1]!.id;
    seoConnectionId = connections[2]!.id;

    const [endUser] = await db.insert(schema.endUsers).values({ orgId }).returning();
    endUserId = endUser!.id;
    const conversations = await db
      .insert(schema.convConversations)
      .values([
        { orgId, channelId: acmeChannelId, endUserId, displayId: 1 },
        { orgId, channelId: globexChannelId, endUserId, displayId: 2 },
      ])
      .returning();
    acmeConversationId = conversations[0]!.id;
    globexConversationId = conversations[1]!.id;

    app = await createApp(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const address = (app.getHttpServer() as { address(): AddressInfo | string | null }).address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    baseUrl = `http://127.0.0.1:${address.port}`;

    const acmeSpace = await adminCall<{ id: string }>('kb_create_space', {
      name: 'Acme',
      slug: 'acme',
    });
    const globexSpace = await adminCall<{ id: string }>('kb_create_space', {
      name: 'Globex',
      slug: 'globex',
    });
    acmeSpaceId = acmeSpace.id;
    globexSpaceId = globexSpace.id;
    acmeDocId = (
      await adminCall<{ id: string }>('kb_create_document', {
        spaceId: acmeSpaceId,
        title: 'Acme returns',
        body: 'Acme returns are accepted within 30 days.',
        audiences: ['admin', 'self_service'],
      })
    ).id;
    globexDocId = (
      await adminCall<{ id: string }>('kb_create_document', {
        spaceId: globexSpaceId,
        title: 'Globex returns',
        body: 'Globex returns are accepted within 14 days.',
        audiences: ['admin', 'self_service'],
      })
    ).id;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.convChannelConnections).where(sql`org_id = ${orgId}`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  async function rawAdminCall(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${adminKey}` } },
    });
    const c = new Client({ name: 'channel-sources-it', version: '0.0.0' });
    await c.connect(transport);
    try {
      return await c.callTool({ name, arguments: args });
    } finally {
      await transport.close();
      await c.close();
    }
  }

  async function adminCall<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = await rawAdminCall(name, args);
    if (result.isError) throw new Error(`${name} failed: ${textOf(result)}`);
    return JSON.parse(textOf(result)) as T;
  }

  function endUserMcp(conversationId?: string) {
    return openEndUserAgentMcpClient({
      db: appDb,
      orgId,
      endUserId,
      conversationId,
      registry: app.get(McpRegistryService),
      scopes: ['kb:read', 'commerce:read'],
    });
  }

  async function searchIds(conversationId?: string): Promise<string[]> {
    const result = (await endUserMcp(conversationId).callTool('kb_search', {
      query: 'returns',
    })) as ToolResult;
    expect(result.isError).toBeFalsy();
    return (JSON.parse(textOf(result)) as Array<{ documentId: string }>).map((h) => h.documentId);
  }

  function resolveAsEndUser(conversationId: string, requested?: string) {
    const actor = buildEndUserAgentActor({ orgId, endUserId, conversationId });
    return appDb.transaction(async (tx) => {
      await applyTenancyGUCs(tx, actor);
      return RequestContextStore.run({ db: tx, actor, correlationId: randomUUID() }, () =>
        app.get(ConnectorsService).resolveScope('commerce', requested),
      );
    });
  }

  it('refuses unknown spaces, non-bindable domains and two connections of one domain', async () => {
    const unknownSpace = await rawAdminCall('conv_set_channel_sources', {
      channelId: acmeChannelId,
      kbSpaceIds: ['ksp_doesnotexist'],
    });
    expect(unknownSpace.isError).toBe(true);
    expect(textOf(unknownSpace)).toContain('conv_invalid: unknown KB space(s): ksp_doesnotexist');

    const seo = await rawAdminCall('conv_set_channel_sources', {
      channelId: acmeChannelId,
      connectionIds: [seoConnectionId],
    });
    expect(seo.isError).toBe(true);
    expect(textOf(seo)).toContain('is a seo connection');

    const twoStores = await rawAdminCall('conv_set_channel_sources', {
      channelId: acmeChannelId,
      connectionIds: [acmeConnectionId, globexConnectionId],
    });
    expect(twoStores.isError).toBe(true);
    expect(textOf(twoStores)).toContain('a channel takes one commerce connection');

    const unknownChannel = await rawAdminCall('conv_set_channel_sources', {
      channelId: 'cch_doesnotexist',
      kbSpaceIds: [],
    });
    expect(unknownChannel.isError).toBe(true);
    expect(textOf(unknownChannel)).toContain('conv_not_found');
  });

  it('sets, reads back and partially updates a channel’s sources', async () => {
    const set = await adminCall<{
      kbSpaces: Array<{ id: string; slug: string }>;
      connections: Array<{ id: string; domain: string }>;
    }>('conv_set_channel_sources', {
      channelId: acmeChannelId,
      kbSpaceIds: [acmeSpaceId, acmeSpaceId],
      connectionIds: [acmeConnectionId],
    });
    expect(set.kbSpaces).toEqual([{ id: acmeSpaceId, slug: 'acme', name: 'Acme' }]);
    expect(set.connections).toEqual([
      { id: acmeConnectionId, name: 'Acme store', vendor: 'magento', domain: 'commerce' },
    ]);

    const afterPartial = await adminCall<{ kbSpaces: unknown[]; connections: unknown[] }>(
      'conv_set_channel_sources',
      { channelId: acmeChannelId, kbSpaceIds: [acmeSpaceId] },
    );
    expect(afterPartial.connections).toHaveLength(1);

    await adminCall('conv_set_channel_sources', {
      channelId: globexChannelId,
      kbSpaceIds: [globexSpaceId],
      connectionIds: [globexConnectionId],
    });
    const read = await adminCall<{ channelId: string; kbSpaces: Array<{ id: string }> }>(
      'conv_get_channel_sources',
      { channelId: globexChannelId },
    );
    expect(read.channelId).toBe(globexChannelId);
    expect(read.kbSpaces.map((s) => s.id)).toEqual([globexSpaceId]);

    const res = await fetch(`${baseUrl}/v1/conversations/channels/sources`, {
      headers: { Authorization: `Bearer ${adminKey}` },
    });
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as {
      items: Array<{
        channelId: string;
        kbSpaces: Array<{ id: string }>;
        connections: Array<{ id: string }>;
      }>;
    };
    const summary = Object.fromEntries(
      items.map((i) => [
        i.channelId,
        { spaces: i.kbSpaces.map((s) => s.id), connections: i.connections.map((c) => c.id) },
      ]),
    );
    expect(summary).toEqual({
      [acmeChannelId]: { spaces: [acmeSpaceId], connections: [acmeConnectionId] },
      [globexChannelId]: { spaces: [globexSpaceId], connections: [globexConnectionId] },
    });
  });

  it('limits an end-user agent’s KB reads to the spaces bound to its conversation’s channel', async () => {
    expect(await searchIds(acmeConversationId)).toEqual([acmeDocId]);
    expect(await searchIds(globexConversationId)).toEqual([globexDocId]);
    expect((await searchIds()).sort()).toEqual([acmeDocId, globexDocId].sort());

    const crossRead = (await endUserMcp(acmeConversationId).callTool('kb_get_document', {
      id: globexDocId,
    })) as ToolResult;
    expect(crossRead.isError).toBe(true);

    const adminSearch = await adminCall<Array<{ documentId: string }>>('kb_search', {
      query: 'returns',
    });
    expect(adminSearch.map((h) => h.documentId).sort()).toEqual([acmeDocId, globexDocId].sort());
  });

  it('resolves the channel’s pinned connection and refuses any other', async () => {
    const scope = await resolveAsEndUser(acmeConversationId);
    expect(scope.connection.id).toBe(acmeConnectionId);

    await expect(resolveAsEndUser(acmeConversationId, globexConnectionId)).rejects.toThrow(
      /bound to connection .* is not available here/,
    );
    const explicitSame = await resolveAsEndUser(globexConversationId, globexConnectionId);
    expect(explicitSame.connection.id).toBe(globexConnectionId);
  });

  it('refuses to delete a connection that a channel is bound to', async () => {
    const result = await rawAdminCall('connectors_delete_connection', {
      connectionId: acmeConnectionId,
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('connectors_connection_bound');
    expect(textOf(result)).toContain('Acme chat');
  });

  it('lifts the restrictions when the lists are emptied', async () => {
    await adminCall('conv_set_channel_sources', {
      channelId: acmeChannelId,
      kbSpaceIds: [],
      connectionIds: [],
    });
    expect((await searchIds(acmeConversationId)).sort()).toEqual([acmeDocId, globexDocId].sort());
    await expect(resolveAsEndUser(acmeConversationId)).rejects.toThrow(
      /multiple active commerce connections/,
    );
  });
});
