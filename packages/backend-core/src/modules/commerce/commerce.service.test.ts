import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ActorIdentity, withContext, type RequestContext } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConnectorsService } from '../connectors/connectors.service.ts';
import { ConnectorRegistry } from '../connectors/connector.ts';
import type { ConnectorFetch } from '../connectors/http.ts';
import { ShopifyAdapter } from './shopify.adapter.ts';
import { CommerceService } from './commerce.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run commerce service tests.';

interface StubCall {
  url: string;
  body: Record<string, unknown> | null;
}

(skipReason ? describe.skip : describe)('CommerceService', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let connectors: ConnectorsService;
  let commerce: CommerceService;
  let orgId: string;
  let adminActor: ActorIdentity;
  let endUserActor: ActorIdentity;

  const calls: StubCall[] = [];
  let respond: (call: StubCall) => { status?: number; body: unknown } = () => ({ body: {} });

  const stubFetch: ConnectorFetch = (url, init) => {
    const call = { url, body: init.body ? (JSON.parse(init.body) as Record<string, unknown>) : null };
    calls.push(call);
    const { status = 200, body } = respond(call);
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    });
  };

  const shopifyOrderNode = {
    id: 'gid://shopify/Order/1001',
    name: '#1001',
    createdAt: '2026-06-01T10:00:00Z',
    cancelledAt: null,
    closedAt: null,
    displayFinancialStatus: 'PAID',
    displayFulfillmentStatus: 'FULFILLED',
    subtotalLineItemsQuantity: 2,
    currentTotalPriceSet: { shopMoney: { amount: '49.90', currencyCode: 'EUR' } },
    customer: { id: 'gid://shopify/Customer/7', email: 'jane@example.com' },
  };

  function respondShopify() {
    respond = (call) => {
      const query = String((call.body as { query?: string } | null)?.query ?? '');
      if (query.includes('customers(')) {
        return {
          body: {
            data: {
              customers: { nodes: [{ id: 'gid://shopify/Customer/7', email: 'jane@example.com' }] },
            },
          },
        };
      }
      return { body: { data: { orders: { nodes: [shopifyOrderNode] } } } };
    };
  }

  beforeAll(async () => {
    process.env.MUNIN_ENCRYPTION_KEY ??= 'integration-test-encryption-key';
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    appDb = createDb(appUrl);

    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'Commerce Service Test Org' })
      .returning();
    orgId = org!.id;
    const [eu] = await db
      .insert(schema.endUsers)
      .values({ orgId, email: 'jane@example.com', name: 'Jane' })
      .returning();

    adminActor = new ActorIdentity('admin_agent', 'agt_commerce_test', orgId, ['*'], ['admin']);
    endUserActor = new ActorIdentity(
      'end_user_agent',
      'tok_commerce_test',
      orgId,
      ['commerce:read'],
      ['self_service'],
      eu!.id,
    );

    connectors = new ConnectorsService(new ConnectorRegistry([new ShopifyAdapter(stubFetch)]));
    commerce = new CommerceService(connectors);
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  beforeEach(async () => {
    calls.length = 0;
    respond = () => ({ body: {} });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await db.execute(sql`DELETE FROM connector_connections WHERE org_id = ${orgId}`);
  });

  function run<T>(fn: () => Promise<T>, runAs: ActorIdentity = adminActor): Promise<T> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${runAs.orgId}, true)`);
      if (runAs.endUserId) {
        await tx.execute(sql`SELECT set_config('app.end_user_id', ${runAs.endUserId}, true)`);
      }
      const ctx: RequestContext = {
        db: tx,
        actor: runAs,
        correlationId: randomUUID(),
      };
      return withContext(ctx, fn);
    });
  }

  function createShopifyConnection() {
    return run(() =>
      connectors.createConnection({
        vendor: 'shopify',
        name: 'Main store',
        config: { shopDomain: 'acme.myshopify.com', accessToken: 'shpat_plaintext_token' },
      }),
    );
  }

  it('lists orders through the connected store for an admin-supplied email', async () => {
    await createShopifyConnection();
    respondShopify();

    const result = await run(() => commerce.lookupOrders({ email: 'Jane@Example.com', limit: 5 }));

    expect(result.connection.vendor).toBe('shopify');
    expect(result.orders[0]!.orderNumber).toBe('#1001');
    const query = String((calls[0]!.body as { query?: string }).query ?? JSON.stringify(calls[0]!.body));
    expect(JSON.stringify(calls.map((c) => c.body))).toContain('jane@example.com');
    expect(query).not.toContain('Jane@Example.com');
  });

  it("resolves self-service lookups with the calling end-user's own email", async () => {
    await createShopifyConnection();
    respondShopify();

    const result = await run(() => commerce.getMyOrders({ limit: 5 }), endUserActor);

    expect(result.orders[0]!.orderNumber).toBe('#1001');
    expect(JSON.stringify(calls.map((c) => c.body))).toContain('jane@example.com');
  });

  it('rejects detail lookups without a ref or number', async () => {
    await createShopifyConnection();
    await expect(run(() => commerce.getMyOrder({}), endUserActor)).rejects.toThrow(
      BadRequestException,
    );
  });

  it("reports not-found for an order that isn't the customer's", async () => {
    await createShopifyConnection();
    respond = (call) => {
      const query = String((call.body as { query?: string } | null)?.query ?? '');
      if (query.includes('customers(')) {
        return { body: { data: { customers: { nodes: [] } } } };
      }
      return { body: { data: { orders: { nodes: [] } } } };
    };

    await expect(
      run(() => commerce.getMyOrder({ orderNumber: '#1001' }), endUserActor),
    ).rejects.toThrow(NotFoundException);
  });
});
