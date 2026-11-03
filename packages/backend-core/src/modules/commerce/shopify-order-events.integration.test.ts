import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { encryptSecretSql, WebhookDispatcher } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { and, eq, sql } from 'drizzle-orm';
import { ProductEventsService } from '../analytics/product-events.service.ts';
import { IdentityService } from '../identity/identity.service.ts';
import { ShopifyOrderEventsService } from './shopify-order-events.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL ? null : 'Set TEST_DATABASE_URL to a Postgres URL to run Shopify order event tests.';
const SECRET = 'shpss_integration_signing_secret';

(skipReason ? describe.skip : describe)('Shopify order events', () => {
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let connectionId: string;
  let bareConnectionId: string;
  let service: ShopifyOrderEventsService;

  beforeAll(async () => {
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const [org] = await db.insert(schema.orgs).values({ name: 'Acme' }).returning();
    orgId = org!.id;
    const [encrypted] = await db.execute<{ ct: string } & Record<string, unknown>>(sql`SELECT ${encryptSecretSql(SECRET)} AS ct`);
    const [connection] = await db
      .insert(schema.connectorConnections)
      .values({
        orgId,
        vendor: 'shopify',
        domain: 'commerce',
        name: 'Store',
        config: { shopDomain: 'acme.myshopify.com', apiVersion: '2025-01', encryptedAccessToken: 'x', encryptedWebhookSecret: encrypted!.ct },
      })
      .returning();
    connectionId = connection!.id;
    const [bare] = await db
      .insert(schema.connectorConnections)
      .values({ orgId, vendor: 'shopify', domain: 'commerce', name: 'Bare', config: { shopDomain: 'b.myshopify.com', apiVersion: '2025-01', encryptedAccessToken: 'x' } })
      .returning();
    bareConnectionId = bare!.id;
    await db.insert(schema.crmContacts).values({ orgId, name: 'Ola Nordmann', email: 'ola@kunde.test', consentLawfulBasis: 'contract' });
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    const webhooks = new WebhookDispatcher();
    service = new ShopifyOrderEventsService(createDb(appUrl), new ProductEventsService(webhooks, new IdentityService(webhooks)));
  });

  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    for (const table of ['analytics_product_events', 'events', 'crm_contacts', 'end_users', 'connector_connections']) {
      await db.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE org_id = ${orgId}`);
    }
    await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId));
  });

  const order = Buffer.from(
    JSON.stringify({ id: 1001, name: '#1001', email: 'Ola@Kunde.test', total_price: '199.00', currency: 'NOK', financial_status: 'paid' }),
  );
  const hmac = (body: Buffer) => createHmac('sha256', SECRET).update(body).digest('base64');

  it('records a signed paid order once as an order.paid event on the matching contact', async () => {
    const send = () =>
      service.receive({ connectionId, rawBody: order, hmac: hmac(order), topic: 'orders/paid', webhookId: 'wh_paid_1' });
    expect(await send()).toEqual({ status: 'recorded' });
    expect(await send()).toEqual({ status: 'duplicate' });

    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const rows = await db
      .select()
      .from(schema.analyticsProductEvents)
      .where(and(eq(schema.analyticsProductEvents.orgId, orgId), eq(schema.analyticsProductEvents.name, 'order.paid')));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.contactId).not.toBeNull();
    expect(rows[0]!.properties).toMatchObject({ orderNumber: '#1001', totalPrice: '199.00', source: 'shopify' });
  });

  it('refuses unsigned or wrongly signed calls and connections without a signing secret', async () => {
    await expect(
      service.receive({ connectionId, rawBody: order, hmac: hmac(Buffer.from('other')), topic: 'orders/paid', webhookId: 'wh_2' }),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      service.receive({ connectionId: bareConnectionId, rawBody: order, hmac: hmac(order), topic: 'orders/paid', webhookId: 'wh_3' }),
    ).rejects.toThrow(NotFoundException);
    expect(
      await service.receive({ connectionId, rawBody: order, hmac: hmac(order), topic: 'products/update', webhookId: 'wh_4' }),
    ).toEqual({ status: 'ignored' });
  });
});
