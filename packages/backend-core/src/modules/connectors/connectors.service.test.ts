import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ActorIdentity, getCurrentContext, withContext, type RequestContext } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConnectorsService } from './connectors.service.ts';
import { ConnectorRegistry } from './connector.ts';
import { ShopifyAdapter } from './commerce/shopify.adapter.ts';
import { MagentoAdapter } from './commerce/magento.adapter.ts';
import { CommerceService } from './commerce/commerce.service.ts';
import { GastroplannerAdapter } from './bookings/gastroplanner.adapter.ts';
import { BookingsService } from './bookings/bookings.service.ts';
import type { ConnectorFetch } from './http.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run connectors service tests.';

interface StubCall {
  url: string;
  body: Record<string, unknown> | null;
}

(skipReason ? describe.skip : describe)('ConnectorsService', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let connectors: ConnectorsService;
  let commerce: CommerceService;
  let bookings: BookingsService;
  let orgId: string;
  let adminActor: ActorIdentity;
  let endUserId: string;
  let endUserActor: ActorIdentity;
  let noEmailEndUserId: string;

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

  beforeAll(async () => {
    process.env.MUNIN_ENCRYPTION_KEY ??= 'integration-test-encryption-key';
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    appDb = createDb(appUrl);

    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'Connectors Service Test Org' })
      .returning();
    orgId = org!.id;
    const [eu] = await db
      .insert(schema.endUsers)
      .values({ orgId, email: 'jane@example.com', name: 'Jane' })
      .returning();
    endUserId = eu!.id;
    const [euNoEmail] = await db
      .insert(schema.endUsers)
      .values({ orgId, externalId: 'anon-1' })
      .returning();
    noEmailEndUserId = euNoEmail!.id;

    adminActor = new ActorIdentity('admin_agent', 'agt_connectors_test', orgId, ['*'], ['admin']);
    endUserActor = new ActorIdentity(
      'end_user_agent',
      'tok_connectors_test',
      orgId,
      ['commerce:read', 'bookings:read'],
      ['self_service'],
      endUserId,
    );

    connectors = new ConnectorsService(
      new ConnectorRegistry([
        new ShopifyAdapter(stubFetch),
        new MagentoAdapter(stubFetch),
        new GastroplannerAdapter(stubFetch),
      ]),
    );
    commerce = new CommerceService(connectors);
    bookings = new BookingsService(connectors);
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

  function createShopifyConnection(name = 'Main store') {
    return run(() =>
      connectors.createConnection({
        vendor: 'shopify',
        name,
        config: { shopDomain: 'acme.myshopify.com', accessToken: 'shpat_plaintext_token' },
      }),
    );
  }

  function createGastroplannerConnection(name = 'Restaurant') {
    return run(() =>
      connectors.createConnection({
        vendor: 'gastroplanner',
        name,
        config: { apiToken: 'gp_partner_token' },
      }),
    );
  }

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

  const gastroplannerBooking = {
    id: 512,
    date: '2026-07-10',
    time: '19:00',
    seating_time: 120,
    number_of_guests: 4,
    status: 'confirmed',
    note: null,
    confirmation_code: 'GP-7F3K',
    venue: { name: 'Bryggen Bistro' },
    customer: { email: 'jane@example.com' },
  };

  function respondByVendor() {
    respond = (call) => {
      if (call.url.includes('gastroplanner')) return { body: [gastroplannerBooking] };
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

  describe('connections', () => {
    it('creates a connection with the domain derived from the vendor and secrets encrypted', async () => {
      const shop = await createShopifyConnection();
      const resto = await createGastroplannerConnection();

      expect(shop.domain).toBe('commerce');
      expect(resto.domain).toBe('bookings');
      expect(JSON.stringify([shop, resto])).not.toMatch(/shpat_plaintext_token|gp_partner_token/);

      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      const rows = await db.select().from(schema.connectorConnections);
      for (const row of rows) {
        expect(JSON.stringify(row.config)).not.toMatch(/shpat_plaintext_token|gp_partner_token/);
      }
    });

    it('rejects a duplicate connection name before hitting the unique index', async () => {
      await createShopifyConnection();
      await expect(createShopifyConnection()).rejects.toThrow(/connectors_conflict/);
    });

    it('rejects an unknown vendor', async () => {
      await expect(
        run(() => connectors.createConnection({ vendor: 'woocommerce', name: 'x', config: {} })),
      ).rejects.toThrow(/unknown vendor/);
    });

    it('keeps the stored secret when config is updated without the token', async () => {
      const dto = await createShopifyConnection();
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      const before = await db.select().from(schema.connectorConnections);
      const ctBefore = (before[0]!.config as { encryptedAccessToken: string }).encryptedAccessToken;

      const updated = await run(() =>
        connectors.updateConnection({
          connectionId: dto.id,
          config: { shopDomain: 'acme-eu.myshopify.com' },
        }),
      );

      expect(updated.settings.shopDomain).toBe('acme-eu.myshopify.com');
      const after = await db.select().from(schema.connectorConnections);
      expect((after[0]!.config as { encryptedAccessToken: string }).encryptedAccessToken).toBe(
        ctBefore,
      );
    });

    it('records credential test failures and clears them on success', async () => {
      const dto = await createShopifyConnection();

      respond = () => ({ status: 401, body: {} });
      const failed = await run(() => connectors.testConnection({ connectionId: dto.id }));
      expect(failed.ok).toBe(false);

      let listed = await run(() => connectors.listConnections());
      expect(listed[0]!.lastTestError).toMatch(/401/);

      respond = () => ({
        body: { data: { shop: { name: 'Acme', myshopifyDomain: 'acme.myshopify.com' } } },
      });
      const passed = await run(() => connectors.testConnection({ connectionId: dto.id }));
      expect(passed).toEqual({ ok: true, detail: 'connected to Acme (acme.myshopify.com)' });

      listed = await run(() => connectors.listConnections());
      expect(listed[0]!.lastTestError).toBeNull();
    });
  });

  describe('domain scoping', () => {
    it('resolves each domain to its own single active connection without connectionId', async () => {
      await createShopifyConnection();
      await createGastroplannerConnection();
      respondByVendor();

      const orders = await run(() => commerce.getMyOrders({ limit: 5 }), endUserActor);
      const reservations = await run(() => bookings.getMyReservations({ limit: 5 }), endUserActor);

      expect(orders.orders[0]!.orderNumber).toBe('#1001');
      expect(orders.connection.vendor).toBe('shopify');
      expect(reservations.reservations[0]!.confirmationCode).toBe('GP-7F3K');
      expect(reservations.connection.vendor).toBe('gastroplanner');
    });

    it('rejects a connectionId that belongs to another domain', async () => {
      await createShopifyConnection();
      const resto = await createGastroplannerConnection();

      await expect(
        run(() => commerce.getMyOrders({ connectionId: resto.id, limit: 5 }), endUserActor),
      ).rejects.toThrow(/is a bookings connection, not commerce/);
    });

    it('requires connectionId only when the same domain has multiple active connections', async () => {
      await createShopifyConnection('Store A');
      await createShopifyConnection('Store B');
      await createGastroplannerConnection();
      respondByVendor();

      await expect(run(() => commerce.getMyOrders({ limit: 5 }), endUserActor)).rejects.toThrow(
        /multiple active commerce connections/,
      );
      const reservations = await run(() => bookings.getMyReservations({ limit: 5 }), endUserActor);
      expect(reservations.reservations).toHaveLength(1);
    });
  });

  describe('self-service identity', () => {
    it("resolves lookups using the calling end-user's own email", async () => {
      await createGastroplannerConnection();
      respondByVendor();

      await run(() => bookings.getMyReservations({ limit: 5 }), endUserActor);

      const url = new URL(calls[0]!.url);
      expect(url.searchParams.get('email')).toBe('jane@example.com');
    });

    it('refuses lookups for an end-user record without an email', async () => {
      await createGastroplannerConnection();
      const anonActor = new ActorIdentity(
        'end_user_agent',
        'tok_anon',
        orgId,
        ['bookings:read'],
        ['self_service'],
        noEmailEndUserId,
      );

      await expect(run(() => bookings.getMyReservations({ limit: 5 }), anonActor)).rejects.toThrow(
        /no email identity/,
      );
      expect(calls).toHaveLength(0);
    });

    it("reports not-found for another guest's reservation", async () => {
      await createGastroplannerConnection();
      respond = () => ({
        body: [{ ...gastroplannerBooking, customer: { email: 'mallory@example.com' } }],
      });

      await expect(
        run(() => bookings.getMyReservation({ confirmationCode: 'GP-7F3K' }), endUserActor),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects detail lookups without a ref or code', async () => {
      await createGastroplannerConnection();
      await expect(run(() => bookings.getMyReservation({}), endUserActor)).rejects.toThrow(
        BadRequestException,
      );
      await expect(run(() => commerce.getMyOrder({}), endUserActor)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('RLS', () => {
    it('lets an end-user context read connections but not write them', async () => {
      const dto = await createShopifyConnection();

      const visible = await run(
        () => getCurrentContext().db.select().from(schema.connectorConnections),
        endUserActor,
      );
      expect(visible.map((r) => r.id)).toEqual([dto.id]);

      await expect(
        run(
          () =>
            getCurrentContext()
              .db.update(schema.connectorConnections)
              .set({ name: 'hijacked' })
              .where(sql`id = ${dto.id}`)
              .returning(),
          endUserActor,
        ),
      ).rejects.toThrow();

      await expect(
        run(
          () =>
            getCurrentContext()
              .db.insert(schema.connectorConnections)
              .values({ orgId, vendor: 'shopify', domain: 'commerce', name: 'rogue', config: {} })
              .returning(),
          endUserActor,
        ),
      ).rejects.toThrow();
    });

    it('hides connections from other orgs', async () => {
      await createShopifyConnection();
      const [otherOrg] = await db
        .insert(schema.orgs)
        .values({ name: 'Other Connectors Org' })
        .returning();
      const otherActor = new ActorIdentity('admin_agent', 'agt_other', otherOrg!.id, ['*'], ['admin']);

      const listed = await run(() => connectors.listConnections(), otherActor);
      expect(listed).toEqual([]);

      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${otherOrg!.id}`);
    });
  });
});
