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
  : 'Set TEST_DATABASE_URL to a Postgres URL to run CRM transfer integration tests.';

(skipReason ? describe.skip : describe)('CRM transfer: export org A → import org B via /mcp', () => {
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

    const [orgA] = await db.insert(schema.orgs).values({ name: 'CRM Transfer Source Org' }).returning();
    const [orgB] = await db.insert(schema.orgs).values({ name: 'CRM Transfer Target Org' }).returning();
    orgAId = orgA!.id;
    orgBId = orgB!.id;

    adminKeyA = buildApiKey('admin');
    adminKeyB = buildApiKey('admin');
    await db.insert(schema.apiKeys).values([
      {
        orgId: orgAId,
        type: 'admin',
        name: 'crm-transfer-admin-a',
        keyHash: hashSecret(adminKeyA),
        keyPrefix: keyPrefix(adminKeyA),
        scopes: ['*'],
      },
      {
        orgId: orgBId,
        type: 'admin',
        name: 'crm-transfer-admin-b',
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
    const c = new Client({ name: 'crm-transfer-it', version: '0.0.0' });
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

  interface CrmExportData {
    pipelines: Array<{ id: string; slug: string; stages: Array<{ id: string; name: string }> }>;
    segments: Array<{ id: string; name: string }>;
    companies: Array<{ id: string; name: string; domain: string | null }>;
    contacts: Array<{ id: string; email: string | null; companyId: string | null }>;
    deals: Array<{ id: string; name: string; pipelineId: string; stageId: string }>;
    activities: Array<{ id: string; contactId: string | null; dealId: string | null }>;
    relationships: Array<{ id: string; fromId: string; toId: string }>;
  }
  interface ImportResult {
    created: number;
    updated: number;
    skipped: number;
    idMap: Record<string, string>;
    warnings: string[];
  }

  it('moves the CRM graph to a different org, remaps ids, and re-imports idempotently', async () => {
    const seeded = await withClient(adminKeyA, async (c) => {
      const pipeline = firstJson(
        (await c.callTool({
          name: 'crm_create_pipeline',
          arguments: {
            name: 'Sales',
            slug: 'sales',
            stages: [
              { name: 'Lead' },
              { name: 'Won', winLoss: 'won' },
            ],
          },
        })) as never,
      ) as { id: string; stages: Array<{ id: string; name: string }> };

      await c.callTool({
        name: 'crm_create_segment',
        arguments: { name: 'Hot leads', filter: { tagsAny: ['hot'] } },
      });

      const company = firstJson(
        (await c.callTool({
          name: 'crm_create_company',
          arguments: { name: 'Acme Inc', domain: 'acme.example' },
        })) as never,
      ) as { id: string };

      const contact = firstJson(
        (await c.callTool({
          name: 'crm_create_contact',
          arguments: { name: 'Ada Lovelace', email: 'ada@acme.example', companyId: company.id },
        })) as never,
      ) as { id: string };

      const deal = firstJson(
        (await c.callTool({
          name: 'crm_create_deal',
          arguments: {
            name: 'Acme expansion',
            pipelineId: pipeline.id,
            primaryContactId: contact.id,
            companyId: company.id,
            amountCents: 500000,
            currency: 'USD',
          },
        })) as never,
      ) as { id: string };

      await c.callTool({
        name: 'crm_log_activity',
        arguments: { type: 'note', subject: 'Kickoff', contactId: contact.id, dealId: deal.id },
      });

      const exported = firstJson(
        (await c.callTool({ name: 'crm_export', arguments: {} })) as never,
      ) as CrmExportData;
      return { pipeline, company, contact, deal, exported };
    });

    expect(seeded.exported.pipelines.length).toBe(1);
    expect(seeded.exported.segments.length).toBe(1);
    expect(seeded.exported.companies.length).toBe(1);
    expect(seeded.exported.contacts.length).toBe(1);
    expect(seeded.exported.deals.length).toBe(1);
    expect(seeded.exported.activities.length).toBe(1);

    const srcPipelineId = seeded.exported.pipelines[0]!.id;
    const srcStageIds = seeded.exported.pipelines[0]!.stages.map((s) => s.id);
    const srcCompanyId = seeded.exported.companies[0]!.id;
    const srcContactId = seeded.exported.contacts[0]!.id;
    const srcDealId = seeded.exported.deals[0]!.id;
    const srcActivityId = seeded.exported.activities[0]!.id;

    const firstImport = await withClient(adminKeyB, async (c) => {
      const res = await c.callTool({ name: 'crm_import', arguments: { records: seeded.exported } });
      const result = firstJson(res as never) as ImportResult;
      const companies = firstJson(
        (await c.callTool({ name: 'crm_list_companies', arguments: {} })) as never,
      ) as Array<{ id: string; domain: string | null }>;
      const contacts = firstJson(
        (await c.callTool({ name: 'crm_list_contacts', arguments: {} })) as never,
      ) as Array<{ id: string; companyId: string | null }>;
      const deals = firstJson(
        (await c.callTool({ name: 'crm_list_deals', arguments: {} })) as never,
      ) as Array<{ id: string; pipelineId: string }>;
      return { result, companies, contacts, deals };
    });

    expect(firstImport.result.created).toBe(6);
    expect(firstImport.result.idMap[srcPipelineId]).toMatch(/^cpl_/);
    expect(firstImport.result.idMap[srcPipelineId]).not.toBe(srcPipelineId);
    for (const srcStageId of srcStageIds) {
      expect(firstImport.result.idMap[srcStageId]).toMatch(/^cst_/);
    }
    expect(firstImport.result.idMap[srcCompanyId]).toMatch(/^cco_/);
    expect(firstImport.result.idMap[srcContactId]).toMatch(/^cct_/);
    expect(firstImport.result.idMap[srcDealId]).toMatch(/^cdl_/);
    expect(firstImport.result.idMap[srcActivityId]).toMatch(/^cac_/);

    const newCompanyId = firstImport.result.idMap[srcCompanyId];
    const newContact = firstImport.contacts.find((x) => x.companyId === newCompanyId);
    expect(newContact).toBeTruthy();
    expect(firstImport.deals[0]!.pipelineId).toBe(firstImport.result.idMap[srcPipelineId]);

    const secondImport = await withClient(adminKeyB, async (c) => {
      const res = await c.callTool({ name: 'crm_import', arguments: { records: seeded.exported } });
      const result = firstJson(res as never) as ImportResult;
      const companies = firstJson(
        (await c.callTool({ name: 'crm_list_companies', arguments: {} })) as never,
      ) as Array<unknown>;
      const contacts = firstJson(
        (await c.callTool({ name: 'crm_list_contacts', arguments: {} })) as never,
      ) as Array<unknown>;
      const deals = firstJson(
        (await c.callTool({ name: 'crm_list_deals', arguments: {} })) as never,
      ) as Array<unknown>;
      return { result, companyCount: companies.length, contactCount: contacts.length, dealCount: deals.length };
    });

    expect(secondImport.result.created).toBe(0);
    expect(secondImport.companyCount).toBe(1);
    expect(secondImport.contactCount).toBe(1);
    expect(secondImport.dealCount).toBe(1);
  });
});
