import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { buildApiKey, hashSecret, keyPrefix } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { AppModule } from '../app.module.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run usage by-agent integration tests.';

interface AgentUsageRow {
  id: string;
  name: string;
  description: string | null;
  mcpCalls: number;
  avgLatencyMs: number | null;
}

(skipReason ? describe.skip : describe)('Usage by-agent attribution', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let otherOrgId: string;
  let adminKey: string;
  let adminKeyId: string;
  let kjellId: string;
  let espenId: string;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod-it-must-be-32-chars';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
    process.env.MUNIN_CMS_SCHEDULE_WORKER_DISABLED = '1';
    process.env.MUNIN_BUILTIN_AGENT = '0';

    await runMigrations(TEST_URL!);
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const [org] = await db.insert(schema.orgs).values({ name: 'By-agent Org' }).returning();
    orgId = org!.id;
    const [otherOrg] = await db
      .insert(schema.orgs)
      .values({ name: 'By-agent Other Org' })
      .returning();
    otherOrgId = otherOrg!.id;

    const [kjell] = await db
      .insert(schema.users)
      .values({ email: `kjell-${randomUUID().slice(0, 8)}@test.example`, name: 'Kjell' })
      .returning();
    kjellId = kjell!.id;
    const [espen] = await db
      .insert(schema.users)
      .values({ email: `espen-${randomUUID().slice(0, 8)}@test.example`, name: 'Espen' })
      .returning();
    espenId = espen!.id;

    await db.insert(schema.oauthClient).values([
      { clientId: 'client_claude', name: 'Claude', redirectUris: ['https://claude.ai/cb'] },
      { clientId: 'client_code', name: 'Claude Code', redirectUris: ['https://claude.ai/cb'] },
    ]);

    adminKey = buildApiKey('admin');
    const [key] = await db
      .insert(schema.apiKeys)
      .values({
        orgId,
        type: 'admin',
        name: 'Deploy key',
        keyHash: hashSecret(adminKey),
        keyPrefix: keyPrefix(adminKey),
        scopes: ['*'],
      })
      .returning();
    adminKeyId = key!.id;

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
      await db.delete(schema.orgs).where(sql`id in (${orgId}, ${otherOrgId})`);
      await db.delete(schema.users).where(sql`id in (${kjellId}, ${espenId})`);
      await db.delete(schema.oauthClient).where(sql`client_id in ('client_claude', 'client_code')`);
      void db.$client.end();
    }
  });

  async function seedToolCall(row: {
    org?: string;
    actorType: string;
    actorId: string | null;
    clientId?: string | null;
    durationMs?: number | null;
    tool?: string;
  }): Promise<void> {
    await db.insert(schema.auditLog).values({
      orgId: row.org ?? orgId,
      actorType: row.actorType,
      actorId: row.actorId,
      clientId: row.clientId ?? null,
      tool: row.tool ?? 'kb_search',
      method: 'POST /mcp',
      result: 'ok',
      durationMs: row.durationMs === undefined ? 100 : row.durationMs,
    });
  }

  async function byAgent(): Promise<AgentUsageRow[]> {
    const res = await fetch(`${baseUrl}/v1/usage/by-agent`, {
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agents: AgentUsageRow[] };
    return body.agents;
  }

  it('separates two OAuth connectors authorized by the same user', async () => {
    await db.delete(schema.auditLog).where(sql`org_id = ${orgId}`);
    await seedToolCall({ actorType: 'user', actorId: kjellId, clientId: 'client_claude' });
    await seedToolCall({ actorType: 'user', actorId: kjellId, clientId: 'client_claude' });
    await seedToolCall({ actorType: 'user', actorId: kjellId, clientId: 'client_code' });

    const agents = await byAgent();
    expect(agents.map((a) => [a.name, a.mcpCalls])).toEqual([
      ['Claude', 2],
      ['Claude Code', 1],
    ]);
    expect(agents[0]!.description).toContain('Kjell');
  });

  it('keeps the same connector separate per authorizing user', async () => {
    await db.delete(schema.auditLog).where(sql`org_id = ${orgId}`);
    await seedToolCall({ actorType: 'user', actorId: kjellId, clientId: 'client_claude' });
    await seedToolCall({ actorType: 'user', actorId: espenId, clientId: 'client_claude' });

    const agents = await byAgent();
    expect(agents).toHaveLength(2);
    expect(agents.every((a) => a.name === 'Claude')).toBe(true);
    expect(new Set(agents.map((a) => a.description))).toEqual(
      new Set(['Kjell', 'Espen']),
    );
  });

  it('names admin API key callers by key name', async () => {
    await db.delete(schema.auditLog).where(sql`org_id = ${orgId}`);
    await seedToolCall({ actorType: 'admin_agent', actorId: adminKeyId });

    const agents = await byAgent();
    expect(agents).toEqual([
      expect.objectContaining({ name: 'Deploy key', description: 'admin_agent', mcpCalls: 1 }),
    ]);
  });

  it('collapses the in-process agent runtime into one agent-host row', async () => {
    await db.delete(schema.auditLog).where(sql`org_id = ${orgId}`);
    await seedToolCall({ actorType: 'admin_agent', actorId: `agent-host:${orgId}` });
    await seedToolCall({ actorType: 'admin_agent', actorId: `agent-host:${orgId}` });

    const agents = await byAgent();
    expect(agents).toEqual([expect.objectContaining({ name: 'agent-host', mcpCalls: 2 })]);
  });

  it('weights average latency by call count and ignores untimed calls', async () => {
    await db.delete(schema.auditLog).where(sql`org_id = ${orgId}`);
    await seedToolCall({
      actorType: 'user',
      actorId: kjellId,
      clientId: 'client_claude',
      durationMs: 100,
    });
    await seedToolCall({
      actorType: 'user',
      actorId: kjellId,
      clientId: 'client_claude',
      durationMs: 300,
    });
    await seedToolCall({
      actorType: 'user',
      actorId: kjellId,
      clientId: 'client_claude',
      durationMs: null,
    });

    const agents = await byAgent();
    expect(agents[0]!.mcpCalls).toBe(3);
    expect(agents[0]!.avgLatencyMs).toBe(200);
  });

  it('excludes non-tool rows and other orgs', async () => {
    await db.delete(schema.auditLog).where(sql`org_id = ${orgId}`);
    await db.insert(schema.auditLog).values({
      orgId,
      actorType: 'user',
      actorId: kjellId,
      clientId: 'client_claude',
      tool: null,
      method: 'GET /v1/activity',
      result: 'ok',
    });
    await seedToolCall({
      org: otherOrgId,
      actorType: 'user',
      actorId: espenId,
      clientId: 'client_claude',
    });

    expect(await byAgent()).toEqual([]);
  });
});
