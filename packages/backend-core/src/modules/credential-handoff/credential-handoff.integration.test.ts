import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ActorIdentity, withContext, type RequestContext } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { ConnectorsService } from '../connectors/connectors.service.ts';
import { ConnectorCredentialHandler } from '../connectors/connector-credential.handler.ts';
import { ConnectorRegistry } from '../connectors/connector.ts';
import type { ConnectorFetch } from '../connectors/http.ts';
import { ShopifyAdapter } from '../commerce/shopify.adapter.ts';
import { CredentialHandoffService } from './credential-handoff.service.ts';
import { CredentialTargetRegistry } from './credential-target.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run credential-handoff tests.';

(skipReason ? describe.skip : describe)('CredentialHandoffService (connector target)', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let connectors: ConnectorsService;
  let handoff: CredentialHandoffService;
  let orgId: string;
  let adminActor: ActorIdentity;

  let respond: () => { status?: number; body: unknown } = () => ({ body: {} });
  const stubFetch: ConnectorFetch = () => {
    const { status = 200, body } = respond();
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    });
  };

  beforeAll(async () => {
    process.env.MUNIN_ENCRYPTION_KEY ??= 'integration-test-encryption-key';
    process.env.MUNIN_KEY_PEPPER ??= 'integration-test-pepper';
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    appDb = createDb(appUrl);

    const [org] = await db.insert(schema.orgs).values({ name: 'Handoff Test Org' }).returning();
    orgId = org!.id;
    adminActor = new ActorIdentity('admin_agent', 'agt_handoff', orgId, ['*'], ['admin']);

    const registry = new ConnectorRegistry([new ShopifyAdapter(stubFetch)]);
    const targets = new CredentialTargetRegistry();
    handoff = new CredentialHandoffService(db, targets);
    connectors = new ConnectorsService(registry, handoff, db);
    targets.register(new ConnectorCredentialHandler(connectors));
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  beforeEach(async () => {
    respond = () => ({ body: {} });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await db.execute(sql`DELETE FROM credential_requests WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM connector_connections WHERE org_id = ${orgId}`);
  });

  function asAdmin<T>(fn: () => Promise<T>): Promise<T> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
      const ctx: RequestContext = { db: tx, actor: adminActor, correlationId: randomUUID() };
      return withContext(ctx, fn);
    });
  }

  function tokenFromUrl(url: string): string {
    return new URL(url).searchParams.get('token')!;
  }

  it('creates a pending connection with a link when the secret is omitted', async () => {
    const created = await asAdmin(() =>
      connectors.createConnection({
        vendor: 'shopify',
        name: 'Main store',
        config: { shopDomain: 'acme.myshopify.com' },
      }),
    );
    expect(created.credentialState).toBe('pending');
    expect(created.active).toBe(false);
    expect(created.credentialLink?.url).toContain('/connect/credentials?token=mncl_');
    expect(JSON.stringify(created)).not.toContain('shpat_');
  });

  it('describes only the secret fields for a pending link', async () => {
    const created = await asAdmin(() =>
      connectors.createConnection({
        vendor: 'shopify',
        name: 'Main store',
        config: { shopDomain: 'acme.myshopify.com' },
      }),
    );
    const described = await handoff.describe(tokenFromUrl(created.credentialLink!.url));
    expect(described.vendor).toBe('shopify');
    expect(described.fields.map((f) => f.key)).toContain('accessToken');
    expect(described.fields.map((f) => f.key)).not.toContain('shopDomain');
  });

  it('activates the connection when the secret is submitted, and the link is one-time', async () => {
    const created = await asAdmin(() =>
      connectors.createConnection({
        vendor: 'shopify',
        name: 'Main store',
        config: { shopDomain: 'acme.myshopify.com' },
      }),
    );
    const token = tokenFromUrl(created.credentialLink!.url);
    respond = () => ({ body: { data: { shop: { name: 'Acme', myshopifyDomain: 'acme.myshopify.com' } } } });

    const result = await handoff.complete(token, { accessToken: 'shpat_live_secret' });
    expect(result.ok).toBe(true);

    const listed = await asAdmin(() => connectors.listConnections());
    expect(listed[0]!.credentialState).toBe('active');
    expect(listed[0]!.active).toBe(true);

    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const rows = await db.select().from(schema.connectorConnections);
    expect(JSON.stringify(rows[0]!.config)).not.toContain('shpat_live_secret');

    await expect(handoff.complete(token, { accessToken: 'shpat_again' })).rejects.toThrow(
      /invalid or expired/,
    );
  });

  it('saves credentials then surfaces a failed vendor probe and records the error', async () => {
    const created = await asAdmin(() =>
      connectors.createConnection({
        vendor: 'shopify',
        name: 'Main store',
        config: { shopDomain: 'acme.myshopify.com' },
      }),
    );
    const token = tokenFromUrl(created.credentialLink!.url);
    respond = () => ({ status: 401, body: {} });

    const result = await handoff.complete(token, { accessToken: 'shpat_bad_token' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/401|403/);

    const listed = await asAdmin(() => connectors.listConnections());
    expect(listed[0]!.credentialState).toBe('active');
    expect(listed[0]!.lastTestError).toMatch(/401|403/);
  });

  it('rejects an expired link', async () => {
    const created = await asAdmin(() =>
      connectors.createConnection({
        vendor: 'shopify',
        name: 'Main store',
        config: { shopDomain: 'acme.myshopify.com' },
      }),
    );
    const token = tokenFromUrl(created.credentialLink!.url);
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await db.execute(
      sql`UPDATE credential_requests SET expires_at = now() - interval '1 hour' WHERE org_id = ${orgId}`,
    );
    await expect(handoff.describe(token)).rejects.toThrow(/invalid or expired/);
  });
});
