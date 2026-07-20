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
  : 'Set TEST_DATABASE_URL to a Postgres URL to run outreach transfer integration tests.';

(skipReason ? describe.skip : describe)('Outreach transfer: export org A → import org B via /mcp', () => {
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

    const [orgA] = await db.insert(schema.orgs).values({ name: 'Outreach Source Org' }).returning();
    const [orgB] = await db.insert(schema.orgs).values({ name: 'Outreach Target Org' }).returning();
    orgAId = orgA!.id;
    orgBId = orgB!.id;

    adminKeyA = buildApiKey('admin');
    adminKeyB = buildApiKey('admin');
    await db.insert(schema.apiKeys).values([
      { orgId: orgAId, type: 'admin', name: 'outreach-a', keyHash: hashSecret(adminKeyA), keyPrefix: keyPrefix(adminKeyA), scopes: ['*'] },
      { orgId: orgBId, type: 'admin', name: 'outreach-b', keyHash: hashSecret(adminKeyB), keyPrefix: keyPrefix(adminKeyB), scopes: ['*'] },
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
    const c = new Client({ name: 'outreach-transfer-it', version: '0.0.0' });
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

  interface ImportResult {
    created: number;
    updated: number;
    skipped: number;
    idMap: Record<string, string>;
    warnings: string[];
  }
  interface OutreachExportData {
    campaigns: Array<{
      id: string;
      name: string;
      segmentId: string;
      channelId: string;
      autoDraftInitial: boolean;
      autoDraftReplies: boolean;
      sequenceSteps: Array<{ waitDays: number; brief: string }>;
    }>;
    proposals: Array<{ id: string; campaignId: string; contactId: string; kind: string; sequenceStep: number | null }>;
  }

  it('moves campaigns + proposals to a different org, remapping segment/channel/contact FKs via the threaded idMap', async () => {
    const seeded = await withClient(adminKeyA, async (c) => {
      const channel = firstJson(
        (await c.callTool({
          name: 'conv_create_channel',
          arguments: { type: 'email', vendor: 'smtp', name: 'Newsletter', config: {} },
        })) as never,
      ) as { id: string };
      const segment = firstJson(
        (await c.callTool({
          name: 'crm_create_segment',
          arguments: { name: 'Warm leads', filter: { tagsAny: ['warm'] } },
        })) as never,
      ) as { id: string };
      const contact = firstJson(
        (await c.callTool({
          name: 'crm_create_contact',
          arguments: { name: 'Ada Lovelace', email: 'ada@example.com' },
        })) as never,
      ) as { id: string };
      const campaign = firstJson(
        (await c.callTool({
          name: 'outreach_create_campaign',
          arguments: {
            name: 'Spring promo',
            brief: 'Re-engage warm leads.',
            segmentId: segment.id,
            channelId: channel.id,
            autoDraftInitial: true,
            autoDraftReplies: false,
            sequenceSteps: [
              { waitDays: 3, brief: 'gentle bump' },
              { waitDays: 7, brief: 'breakup email' },
            ],
          },
        })) as never,
      ) as { id: string };
      return { channel, segment, contact, campaign };
    });

    await db.insert(schema.outreachProposals).values([
      {
        orgId: orgAId,
        campaignId: seeded.campaign.id,
        contactId: seeded.contact.id,
        kind: 'initial',
        draftSubject: 'Hello from Munin',
        draftBody: 'We would love to reconnect.',
        status: 'pending',
        proposedByActorType: 'agent',
        proposedByActorId: 'seed',
      },
      {
        orgId: orgAId,
        campaignId: seeded.campaign.id,
        contactId: seeded.contact.id,
        kind: 'followup',
        sequenceStep: 1,
        draftBody: 'Bumping this.',
        status: 'sent',
        sentAt: new Date(),
        proposedByActorType: 'agent',
        proposedByActorId: 'seed',
      },
      {
        orgId: orgAId,
        campaignId: seeded.campaign.id,
        contactId: seeded.contact.id,
        kind: 'followup',
        sequenceStep: 2,
        draftBody: 'Closing the loop.',
        status: 'sent',
        sentAt: new Date(),
        proposedByActorType: 'agent',
        proposedByActorId: 'seed',
      },
    ]);

    const exports = await withClient(adminKeyA, async (c) => ({
      crm: firstJson((await c.callTool({ name: 'crm_export', arguments: {} })) as never),
      conv: firstJson((await c.callTool({ name: 'conv_export', arguments: {} })) as never),
      outreach: firstJson((await c.callTool({ name: 'outreach_export', arguments: {} })) as never) as OutreachExportData,
    }));

    expect(exports.outreach.campaigns.length).toBe(1);
    expect(exports.outreach.proposals.length).toBe(3);
    const srcCampaignId = exports.outreach.campaigns[0]!.id;
    const srcProposalId = exports.outreach.proposals.find((p) => p.kind === 'initial')!.id;
    const srcSegmentId = exports.outreach.campaigns[0]!.segmentId;

    const migrated = await withClient(adminKeyB, async (c) => {
      const crmRes = firstJson(
        (await c.callTool({ name: 'crm_import', arguments: { records: exports.crm } })) as never,
      ) as ImportResult;
      const convRes = firstJson(
        (await c.callTool({ name: 'conv_import', arguments: { records: exports.conv, idMap: crmRes.idMap } })) as never,
      ) as ImportResult;
      const outreachRes = firstJson(
        (await c.callTool({
          name: 'outreach_import',
          arguments: { records: exports.outreach, idMap: convRes.idMap },
        })) as never,
      ) as ImportResult;
      const onB = firstJson(
        (await c.callTool({ name: 'outreach_export', arguments: {} })) as never,
      ) as OutreachExportData;
      const reimport = firstJson(
        (await c.callTool({
          name: 'outreach_import',
          arguments: { records: exports.outreach, idMap: convRes.idMap },
        })) as never,
      ) as ImportResult;
      return { outreachRes, onB, reimport };
    });

    expect(migrated.outreachRes.created).toBe(4);
    expect(migrated.outreachRes.idMap[srcCampaignId]).toMatch(/^ocmp_/);
    expect(migrated.outreachRes.idMap[srcProposalId]).toMatch(/^oprp_/);
    expect(migrated.outreachRes.warnings.some((w) => w.includes('imported disabled'))).toBe(true);

    expect(migrated.onB.campaigns.length).toBe(1);
    expect(migrated.onB.proposals.length).toBe(3);
    expect(migrated.onB.campaigns[0]!.segmentId).not.toBe(srcSegmentId);
    expect(migrated.onB.campaigns[0]!.segmentId).toBe(migrated.outreachRes.idMap[srcSegmentId]);
    expect(migrated.onB.campaigns[0]!.autoDraftInitial).toBe(true);
    expect(migrated.onB.campaigns[0]!.autoDraftReplies).toBe(false);
    expect(migrated.onB.campaigns[0]!.sequenceSteps).toEqual([
      { waitDays: 3, brief: 'gentle bump' },
      { waitDays: 7, brief: 'breakup email' },
    ]);
    const followupSteps = migrated.onB.proposals
      .filter((p) => p.kind === 'followup')
      .map((p) => p.sequenceStep)
      .sort();
    expect(followupSteps).toEqual([1, 2]);

    expect(migrated.reimport.created).toBe(0);
    expect(migrated.reimport.skipped).toBe(4);
  });
});
