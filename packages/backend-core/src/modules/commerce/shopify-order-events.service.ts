import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { schema, type Db } from '@getmunin/db';
import { ActorIdentity, decryptSecretSql, getCurrentContext, readApiBaseUrl, withContext } from '@getmunin/core';
import { DB } from '../../common/db/db.module.ts';
import { applyTenancyGUCs } from '../../common/tenancy/tenancy.interceptor.ts';
import { ProductEventsService } from '../analytics/product-events.service.ts';
import { SHOPIFY_ORDER_TOPICS, shopifyOrderEvent, verifyShopifyHmac } from './shopify-order-events.ts';

export const SHOPIFY_WEBHOOK_ACTOR_ID = 'shopify-webhook';

export interface OrderEventSetupDto {
  connectionId: string;
  name: string;
  shopDomain: string | null;
  webhookUrl: string;
  signingSecretSet: boolean;
  topics: { topic: string; event: string }[];
}

type EventRecorder = Pick<ProductEventsService, 'record'>;

@Injectable()
export class ShopifyOrderEventsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ProductEventsService) private readonly productEvents: EventRecorder,
  ) {}

  async receive(input: {
    connectionId: string;
    rawBody: Buffer | undefined;
    hmac: string | undefined;
    topic: string | undefined;
    webhookId: string | undefined;
  }): Promise<{ status: 'recorded' | 'duplicate' | 'ignored' }> {
    const connection = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      const [row] = await tx
        .select({
          orgId: schema.connectorConnections.orgId,
          vendor: schema.connectorConnections.vendor,
          active: schema.connectorConnections.active,
          config: schema.connectorConnections.config,
        })
        .from(schema.connectorConnections)
        .where(eq(schema.connectorConnections.id, input.connectionId))
        .limit(1);
      const ciphertext = typeof row?.config.encryptedWebhookSecret === 'string' ? row.config.encryptedWebhookSecret : null;
      if (!row || row.vendor !== 'shopify' || !row.active || !ciphertext) return null;
      const decrypted = await tx.execute<{ pt: string } & Record<string, unknown>>(
        sql`SELECT ${decryptSecretSql(ciphertext)} AS pt`,
      );
      return { orgId: row.orgId, shopDomain: typeof row.config.shopDomain === 'string' ? row.config.shopDomain : '', secret: decrypted[0]?.pt ?? null };
    });
    if (!connection?.secret) throw new UnauthorizedException('commerce_unauthorized: webhook not accepted');
    if (!input.rawBody || !verifyShopifyHmac(input.rawBody, connection.secret, input.hmac)) {
      throw new UnauthorizedException('commerce_unauthorized: webhook not accepted');
    }
    if (!input.topic || !input.webhookId) return { status: 'ignored' };
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(input.rawBody.toString('utf8')) as Record<string, unknown>;
    } catch {
      return { status: 'ignored' };
    }
    const event = shopifyOrderEvent({ topic: input.topic, shopDomain: connection.shopDomain, rawBody: input.rawBody, body });
    if (!event) return { status: 'ignored' };
    const actor = new ActorIdentity('system', SHOPIFY_WEBHOOK_ACTOR_ID, connection.orgId, ['*'], ['admin']);
    const [result] = await this.db.transaction(async (tx) => {
      await applyTenancyGUCs(tx, actor);
      return withContext({ db: tx, actor, correlationId: randomUUID() }, () => this.productEvents.record([event]));
    });
    return { status: result?.status === 'duplicate' ? 'duplicate' : 'recorded' };
  }

  async setup(): Promise<OrderEventSetupDto[]> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({ id: schema.connectorConnections.id, name: schema.connectorConnections.name, config: schema.connectorConnections.config })
      .from(schema.connectorConnections)
      .where(and(eq(schema.connectorConnections.orgId, ctx.actor!.orgId), eq(schema.connectorConnections.vendor, 'shopify')));
    const base = readApiBaseUrl().replace(/\/+$/, '');
    return rows.map((r) => ({
      connectionId: r.id,
      name: r.name,
      shopDomain: typeof r.config.shopDomain === 'string' ? r.config.shopDomain : null,
      webhookUrl: `${base}/v1/commerce/shopify/webhooks/${r.id}`,
      signingSecretSet: typeof r.config.encryptedWebhookSecret === 'string',
      topics: Object.entries(SHOPIFY_ORDER_TOPICS).map(([topic, event]) => ({ topic, event })),
    }));
  }
}
