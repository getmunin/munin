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
import { AppModule } from '../app.module.js';

const TEST_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set DATABASE_URL or TEST_DATABASE_URL to a Postgres URL to run overview integration tests.';

(skipReason ? describe.skip : describe)('Overview backlog controller', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgAId: string;
  let orgBId: string;
  let adminKeyA: string;
  let adminKeyB: string;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod-it-must-be-32-chars';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';

    await runMigrations(TEST_URL!);
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const ts = Date.now();
    const [orgA] = await db
      .insert(schema.orgs)
      .values({ name: 'Overview Org A', slug: `ov-a-${ts}` })
      .returning();
    orgAId = orgA!.id;
    const [orgB] = await db
      .insert(schema.orgs)
      .values({ name: 'Overview Org B', slug: `ov-b-${ts}` })
      .returning();
    orgBId = orgB!.id;

    adminKeyA = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId: orgAId,
      type: 'admin',
      name: 'a',
      keyHash: hashSecret(adminKeyA),
      keyPrefix: keyPrefix(adminKeyA),
      scopes: ['*'],
    });
    adminKeyB = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId: orgBId,
      type: 'admin',
      name: 'b',
      keyHash: hashSecret(adminKeyB),
      keyPrefix: keyPrefix(adminKeyB),
      scopes: ['*'],
    });

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
      await db.delete(schema.orgs).where(sql`id IN (${orgAId}, ${orgBId})`);
    }
  });

  async function getBacklog(adminKey: string): Promise<{
    conversationsNeedingAttention: number;
    kbCurationPending: number;
    crmMergeProposalsPending: number;
  }> {
    const res = await fetch(`${baseUrl}/api/overview/backlog`, {
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect(res.ok).toBe(true);
    return (await res.json()) as {
      conversationsNeedingAttention: number;
      kbCurationPending: number;
      crmMergeProposalsPending: number;
    };
  }

  async function withClient<T>(token: string, fn: (c: Client) => Promise<T>): Promise<T> {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const c = new Client({ name: 'overview-it', version: '0.0.0' });
    await c.connect(transport);
    try {
      return await fn(c);
    } finally {
      await transport.close();
      await c.close();
    }
  }

  it('returns zeros for an empty org', async () => {
    const backlog = await getBacklog(adminKeyA);
    expect(backlog).toEqual({
      conversationsNeedingAttention: 0,
      kbCurationPending: 0,
      crmMergeProposalsPending: 0,
    });
  });

  it('agent-status reports zero subscribers when nothing is connected', async () => {
    const res = await fetch(`${baseUrl}/api/overview/agent-status`, {
      headers: { authorization: `Bearer ${adminKeyA}` },
    });
    expect(res.ok).toBe(true);
    const body = (await res.json()) as {
      selfServiceAgentSubscriberCount: number;
      lastInboundEndUserMessageAt: string | null;
      lastAgentMessageAt: string | null;
    };
    expect(body.selfServiceAgentSubscriberCount).toBe(0);
    expect(body.lastInboundEndUserMessageAt).toBeNull();
    expect(body.lastAgentMessageAt).toBeNull();
  });

  it('counts conversations needing attention scoped to caller org', async () => {
    // Seed channels + conversations directly (service-role).
    const [chanA] = await db
      .insert(schema.convChannels)
      .values({ orgId: orgAId, type: 'chat', name: 'A chat', config: {} })
      .returning();
    await db.insert(schema.convConversations).values({
      orgId: orgAId,
      channelId: chanA!.id,
      displayId: 1,
      status: 'open',
      needsHumanAttention: true,
      needsHumanAttentionAt: new Date(),
    });
    await db.insert(schema.convConversations).values({
      orgId: orgAId,
      channelId: chanA!.id,
      displayId: 2,
      status: 'open',
      needsHumanAttention: false,
    });

    const a = await getBacklog(adminKeyA);
    expect(a.conversationsNeedingAttention).toBe(1);

    // org B sees zero — RLS isolation.
    const b = await getBacklog(adminKeyB);
    expect(b.conversationsNeedingAttention).toBe(0);
  });

  it('counts pending KB curation candidates scoped to caller org', async () => {
    await withClient(adminKeyA, async (c) => {
      await c.callTool({
        name: 'kb_propose_curation_candidate',
        arguments: { subject: 'Refunds', draftBody: 'Refunds within 14 days.' },
      });
      await c.callTool({
        name: 'kb_propose_curation_candidate',
        arguments: { subject: 'Hours', draftBody: '10–18 weekdays.' },
      });
    });
    await withClient(adminKeyB, async (c) => {
      await c.callTool({
        name: 'kb_propose_curation_candidate',
        arguments: { subject: 'Other org thing', draftBody: 'private to B' },
      });
    });

    const a = await getBacklog(adminKeyA);
    expect(a.kbCurationPending).toBe(2);

    const b = await getBacklog(adminKeyB);
    expect(b.kbCurationPending).toBe(1);
  });

  it('counts pending CRM merge proposals scoped to caller org and ignores applied/dismissed', async () => {
    await withClient(adminKeyA, async (c) => {
      const a = (await c.callTool({
        name: 'crm_create_contact',
        arguments: { name: 'A', email: 'merge@a.org' },
      })) as { content: Array<{ text: string }> };
      const b = (await c.callTool({
        name: 'crm_create_contact',
        arguments: { name: 'B', email: 'merge@a.org' },
      })) as { content: Array<{ text: string }> };
      const aId = (JSON.parse(a.content[0]!.text) as { id: string }).id;
      const bId = (JSON.parse(b.content[0]!.text) as { id: string }).id;
      await c.callTool({
        name: 'crm_propose_merge_candidate',
        arguments: {
          contactAId: aId,
          contactBId: bId,
          confidence: 'high',
          evidence: { sameEmail: 'merge@a.org' },
          recommendedKeeperId: aId,
        },
      });
      const c2 = (await c.callTool({
        name: 'crm_create_contact',
        arguments: { name: 'C', email: 'other@a.org' },
      })) as { content: Array<{ text: string }> };
      const d2 = (await c.callTool({
        name: 'crm_create_contact',
        arguments: { name: 'D', email: 'other@a.org' },
      })) as { content: Array<{ text: string }> };
      const cId = (JSON.parse(c2.content[0]!.text) as { id: string }).id;
      const dId = (JSON.parse(d2.content[0]!.text) as { id: string }).id;
      const dismissed = (await c.callTool({
        name: 'crm_propose_merge_candidate',
        arguments: {
          contactAId: cId,
          contactBId: dId,
          confidence: 'medium',
          evidence: {},
          recommendedKeeperId: cId,
        },
      })) as { content: Array<{ text: string }> };
      const dismissedId = (JSON.parse(dismissed.content[0]!.text) as { id: string }).id;
      await c.callTool({
        name: 'crm_dismiss_merge_proposal',
        arguments: { id: dismissedId, reason: 'shared inbox' },
      });
    });

    const a = await getBacklog(adminKeyA);
    expect(a.crmMergeProposalsPending).toBe(1);

    const b = await getBacklog(adminKeyB);
    expect(b.crmMergeProposalsPending).toBe(0);
  });
});
