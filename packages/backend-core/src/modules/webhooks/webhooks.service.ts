import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { and, desc, eq, isNotNull, isNull, asc } from 'drizzle-orm';
import { schema } from '@getmunin/db';
import { getCurrentContext, randomToken } from '@getmunin/core';
import { EVENT_TYPES_BY_MODULE, KNOWN_EVENT_TYPES } from '@getmunin/types';

export interface WebhookDto {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  /** Plaintext shared secret — returned ONCE at creation time. */
  secret?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDeliveryDto {
  id: string;
  webhookId: string;
  eventId: string;
  attempt: number;
  statusCode: number | null;
  durationMs: number | null;
  error: string | null;
  deliveredAt: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
  status: 'pending' | 'delivered' | 'failed';
}

export interface CreateWebhookInput {
  url: string;
  events?: string[];
  active?: boolean;
}

export interface UpdateWebhookInput {
  url?: string;
  events?: string[];
  active?: boolean;
}

export interface ListDeliveriesInput {
  webhookId: string;
  limit?: number;
  status?: 'pending' | 'delivered' | 'failed';
}

export interface EventTypeCatalog {
  modules: Record<string, readonly string[]>;
  all: readonly string[];
}

function assertHttpsUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BadRequestException('webhook URL is not a valid URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new BadRequestException('webhook URL must use https://');
  }
}

function toDto(row: typeof schema.webhooks.$inferSelect): WebhookDto {
  return {
    id: row.id,
    url: row.url,
    events: row.events,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDeliveryDto(row: typeof schema.webhookDeliveries.$inferSelect): WebhookDeliveryDto {
  const delivered = row.deliveredAt !== null;
  const status: WebhookDeliveryDto['status'] = delivered
    ? row.statusCode !== null && row.statusCode >= 200 && row.statusCode < 300
      ? 'delivered'
      : 'failed'
    : 'pending';
  return {
    id: row.id,
    webhookId: row.webhookId,
    eventId: row.eventId,
    attempt: row.attempt,
    statusCode: row.statusCode,
    durationMs: row.durationMs,
    error: row.error,
    deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
    nextAttemptAt: row.nextAttemptAt ? row.nextAttemptAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    status,
  };
}

@Injectable()
export class WebhooksService {
  async list(): Promise<WebhookDto[]> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const rows = await ctx.db
      .select()
      .from(schema.webhooks)
      .where(eq(schema.webhooks.orgId, actor.orgId))
      .orderBy(asc(schema.webhooks.createdAt));
    return rows.map(toDto);
  }

  async create(input: CreateWebhookInput): Promise<WebhookDto> {
    assertHttpsUrl(input.url);
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const secret = `whsec_${randomToken(24)}`;
    const [row] = await ctx.db
      .insert(schema.webhooks)
      .values({
        orgId: actor.orgId,
        url: input.url,
        secret,
        events: input.events ?? [],
        active: input.active ?? true,
      })
      .returning();
    return { ...toDto(row!), secret };
  }

  async update(id: string, patch: UpdateWebhookInput): Promise<WebhookDto> {
    if (patch.url !== undefined) assertHttpsUrl(patch.url);
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.url !== undefined) updates.url = patch.url;
    if (patch.events !== undefined) updates.events = patch.events;
    if (patch.active !== undefined) updates.active = patch.active;
    const result = await ctx.db
      .update(schema.webhooks)
      .set(updates)
      .where(and(eq(schema.webhooks.id, id), eq(schema.webhooks.orgId, actor.orgId)))
      .returning();
    if (!result[0]) throw new NotFoundException(`webhook ${id} not found`);
    return toDto(result[0]);
  }

  async delete(id: string): Promise<{ deleted: true; id: string }> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const result = await ctx.db
      .delete(schema.webhooks)
      .where(and(eq(schema.webhooks.id, id), eq(schema.webhooks.orgId, actor.orgId)))
      .returning({ id: schema.webhooks.id });
    if (result.length === 0) throw new NotFoundException(`webhook ${id} not found`);
    return { deleted: true, id };
  }

  async rotateSecret(id: string): Promise<WebhookDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const secret = `whsec_${randomToken(24)}`;
    const result = await ctx.db
      .update(schema.webhooks)
      .set({ secret, updatedAt: new Date() })
      .where(and(eq(schema.webhooks.id, id), eq(schema.webhooks.orgId, actor.orgId)))
      .returning();
    if (!result[0]) throw new NotFoundException(`webhook ${id} not found`);
    return { ...toDto(result[0]), secret };
  }

  async listDeliveries(input: ListDeliveriesInput): Promise<WebhookDeliveryDto[]> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;

    const [webhook] = await ctx.db
      .select({ id: schema.webhooks.id })
      .from(schema.webhooks)
      .where(and(eq(schema.webhooks.id, input.webhookId), eq(schema.webhooks.orgId, actor.orgId)));
    if (!webhook) throw new NotFoundException(`webhook ${input.webhookId} not found`);

    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const conditions = [eq(schema.webhookDeliveries.webhookId, input.webhookId)];
    if (input.status === 'pending') {
      conditions.push(isNull(schema.webhookDeliveries.deliveredAt));
    } else if (input.status === 'delivered' || input.status === 'failed') {
      conditions.push(isNotNull(schema.webhookDeliveries.deliveredAt));
    }

    const rows = await ctx.db
      .select()
      .from(schema.webhookDeliveries)
      .where(and(...conditions))
      .orderBy(desc(schema.webhookDeliveries.createdAt))
      .limit(limit);

    const mapped = rows.map(toDeliveryDto);
    if (input.status === 'delivered') return mapped.filter((d) => d.status === 'delivered');
    if (input.status === 'failed') return mapped.filter((d) => d.status === 'failed');
    return mapped;
  }

  listEventTypes(): EventTypeCatalog {
    return {
      modules: Object.fromEntries(
        Object.entries(EVENT_TYPES_BY_MODULE).map(([k, v]) => [k, [...v]]),
      ),
      all: [...KNOWN_EVENT_TYPES],
    };
  }
}
