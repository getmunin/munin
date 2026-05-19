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
import { AppModule } from '../../app.module.js';

const TEST_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set DATABASE_URL or TEST_DATABASE_URL to a Postgres URL to run CRM integration tests.';

(skipReason ? describe.skip : describe)('CRM integration: admin + self-service', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let adminKey: string;
  let endUserToken: string;
  let endUserId: string;
  let otherEndUserToken: string;

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

    const ts = Date.now();
    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'CRM IT Org' })
      .returning();
    orgId = org!.id;

    adminKey = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId,
      type: 'admin',
      name: 'crm-it-admin',
      keyHash: hashSecret(adminKey),
      keyPrefix: keyPrefix(adminKey),
      scopes: ['*'],
    });

    const [eu] = await db
      .insert(schema.endUsers)
      .values({ orgId, externalId: 'eu-1', name: 'Alice', email: 'alice@example.com' })
      .returning();
    endUserId = eu!.id;

    endUserToken = buildApiKey('dlg');
    await db.insert(schema.tokens).values({
      orgId,
      type: 'delegated_end_user',
      tokenHash: hashSecret(endUserToken),
      scopes: ['crm:read', 'crm:write'],
      audiences: ['self_service'],
      endUserId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    // Second end-user in the SAME org. Used to assert end-user-vs-end-user
    // isolation: Bob must not be able to read Alice's contact via any tool.
    const [eu2] = await db
      .insert(schema.endUsers)
      .values({ orgId, externalId: 'eu-2', name: 'Bob', email: 'bob@example.com' })
      .returning();
    otherEndUserToken = buildApiKey('dlg');
    await db.insert(schema.tokens).values({
      orgId,
      type: 'delegated_end_user',
      tokenHash: hashSecret(otherEndUserToken),
      scopes: ['crm:read', 'crm:write'],
      audiences: ['self_service'],
      endUserId: eu2!.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
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
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  async function withClient<T>(token: string, fn: (c: Client) => Promise<T>): Promise<T> {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const c = new Client({ name: 'munin-it', version: '0.0.0' });
    await c.connect(transport);
    try {
      return await fn(c);
    } finally {
      await transport.close();
      await c.close();
    }
  }

  it('admin bootstrap → create contact + deal + activity → end-user reads only its own contact', async () => {
    await withClient(adminKey, async (c) => {
      const status = parseToolResult<{ completed: boolean; nextStepId: string | null }>(
        await c.callTool({ name: 'bootstrap_status', arguments: { app: 'crm' } }),
      );
      expect(status.nextStepId).toBe('first_pipeline');
      const finalStatus = parseToolResult<{ completed: boolean }>(
        await c.callTool({
          name: 'bootstrap_answer',
          arguments: { app: 'crm', stepId: 'first_pipeline', value: {} },
        }),
      );
      expect(finalStatus.completed).toBe(true);

      const pipelines = parseToolResult<Array<{ id: string; stages: Array<{ id: string; name: string }> }>>(
        await c.callTool({ name: 'crm_list_pipelines', arguments: {} }),
      );
      expect(pipelines).toHaveLength(1);
      const pipeline = pipelines[0]!;
      const firstStage = pipeline.stages[0]!;

      // Create the end-user's matching CRM contact, plus a sibling for isolation testing.
      const myContact = parseToolResult<{ id: string; name: string | null }>(
        await c.callTool({
          name: 'crm_create_contact',
          arguments: {
            name: 'Alice',
            email: 'alice@example.com',
            phone: '+1-555-0001',
            endUserId,
          },
        }),
      );
      const otherContact = parseToolResult<{ id: string }>(
        await c.callTool({
          name: 'crm_create_contact',
          arguments: { name: 'Bob', email: 'bob@example.com' },
        }),
      );

      const deal = parseToolResult<{ id: string; stageId: string }>(
        await c.callTool({
          name: 'crm_create_deal',
          arguments: {
            name: 'Alice — Q3 expansion',
            pipelineId: pipeline.id,
            primaryContactId: myContact.id,
            amountCents: 100_000,
            currency: 'USD',
          },
        }),
      );
      expect(deal.stageId).toBe(firstStage.id);

      // Move it to "Won" — should stamp closedAt because that stage is winLoss=won.
      const wonStage = pipeline.stages.find((s) => s.name === 'Won')!;
      const moved = parseToolResult<{ closedAt: string | null }>(
        await c.callTool({
          name: 'crm_change_stage',
          arguments: { dealId: deal.id, stageId: wonStage.id },
        }),
      );
      expect(moved.closedAt).not.toBeNull();

      const activity = parseToolResult<{ id: string; contactId: string | null }>(
        await c.callTool({
          name: 'crm_log_activity',
          arguments: {
            type: 'call',
            subject: 'Q3 kickoff call',
            body: 'Spoke with Alice for 20m about the expansion.',
            contactId: myContact.id,
          },
        }),
      );
      expect(activity.contactId).toBe(myContact.id);

      // Updating doNotContact stamps unsubscribedAt automatically.
      const updated = parseToolResult<{ doNotContact: boolean; unsubscribedAt: string | null }>(
        await c.callTool({
          name: 'crm_update_contact',
          arguments: { id: otherContact.id, patch: { doNotContact: true } },
        }),
      );
      expect(updated.doNotContact).toBe(true);
      expect(updated.unsubscribedAt).not.toBeNull();
    });

    // End-user agent: tools/list reflects self-service surface only; sees only own contact.
    await withClient(endUserToken, async (c) => {
      const { tools } = await c.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('crm_get_my_contact');
      expect(names).toContain('crm_update_my_contact');
      expect(names).toContain('crm_log_activity_self');
      expect(names).not.toContain('crm_create_contact');
      expect(names).not.toContain('crm_change_stage');
      expect(names).not.toContain('crm_list_companies');

      const mine = parseToolResult<{ id: string; name: string | null; phone: string | null }>(
        await c.callTool({ name: 'crm_get_my_contact', arguments: {} }),
      );
      expect(mine.name).toBe('Alice');

      const updated = parseToolResult<{ phone: string | null }>(
        await c.callTool({
          name: 'crm_update_my_contact',
          arguments: { phone: '+1-555-0002' },
        }),
      );
      expect(updated.phone).toBe('+1-555-0002');

      const logged = parseToolResult<{ id: string; actorType: string }>(
        await c.callTool({
          name: 'crm_log_activity_self',
          arguments: {
            type: 'call',
            subject: 'Voice agent recap',
            body: 'Spoke with customer for 4m, follow-up needed.',
          },
        }),
      );
      expect(logged.actorType).toBe('end_user');
    });
  }, 30_000);

  it('end-user isolation: Bob cannot read Alice\'s contact via crm_get_my_contact', async () => {
    // Bob has no contact linked to him; getMyContact must NOT return Alice's
    // contact even though it lives in the same org. RLS narrows by end_user_id.
    await withClient(otherEndUserToken, async (c) => {
      const result = (await c.callTool({
        name: 'crm_get_my_contact',
        arguments: {},
      })) as { isError?: boolean; content?: Array<{ text?: string }> };
      expect(result.isError).toBe(true);
      const text = result.content?.[0]?.text ?? '';
      // Either the service throws crm_not_found, or the RLS-filtered query
      // returns zero rows — both surface as a not-found error to the caller.
      expect(text).toMatch(/not.?found|no contact/i);
      expect(text).not.toMatch(/Alice/);
    });
  }, 30_000);
});

function parseToolResult<T>(result: unknown): T {
  const r = result as { content?: Array<{ type: string; text?: string }> };
  const text = r.content?.[0]?.text ?? '';
  return JSON.parse(text) as T;
}
