import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { schema } from '@getmunin/db';
import { and, countDistinct, desc, eq, isNull, max, sql, type SQL } from 'drizzle-orm';
import { getCurrentContext, WebhookDispatcher } from '@getmunin/core';
import { normalizeIdentityEmail } from '../analytics/visitor-identity.ts';

export interface EndUserDto {
  id: string;
  externalId: string | null;
  email: string | null;
  phone: string | null;
  name: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface EndUserPatch {
  externalId?: string;
  email?: string;
  phone?: string;
  name?: string;
  metadata?: Record<string, unknown>;
}

export const IDENTITY_MATCH_KEYS = ['external-id', 'email', 'phone', 'visitor-id'] as const;
export type IdentityMatchKey = (typeof IDENTITY_MATCH_KEYS)[number];

export interface IdentityResolution {
  endUserId: string | null;
  matchedOn: IdentityMatchKey | null;
  externalId: string | null;
  email: string | null;
  phone: string | null;
  name: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  crmContactId: string | null;
}

export interface IdentityProfile extends EndUserDto {
  channels: string[];
  conversationCount: number;
  lastConversationAt: string | null;
  visitorIds: string[];
  viewEventCount: number;
  searchEventCount: number;
  crmContactId: string | null;
  convContactId: string | null;
}

export interface ResolveIdentityInput {
  email?: string;
  phone?: string;
  externalId?: string;
  visitorId?: string;
}

const NO_MATCH: IdentityResolution = {
  endUserId: null,
  matchedOn: null,
  externalId: null,
  email: null,
  phone: null,
  name: null,
  firstSeenAt: null,
  lastSeenAt: null,
  crmContactId: null,
};

@Injectable()
export class IdentityService {
  constructor(@Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher) {}

  async resolve(input: ResolveIdentityInput): Promise<IdentityResolution> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;

    if (input.externalId) {
      const row = await this.selectOne(eq(schema.endUsers.externalId, input.externalId), orgId);
      if (row) return this.toResolution(row, 'external-id');
    }

    const email = normalizeIdentityEmail(input.email);
    if (email) {
      const row = await this.selectOne(sql`lower(${schema.endUsers.email}) = ${email}`, orgId);
      if (row) return this.toResolution(row, 'email');
    }

    if (input.phone) {
      const row = await this.selectOne(eq(schema.endUsers.phone, input.phone.trim()), orgId);
      if (row) return this.toResolution(row, 'phone');
    }

    if (input.visitorId) {
      const linked = await ctx.db
        .select({ endUserId: schema.analyticsVisitorIdentities.endUserId })
        .from(schema.analyticsVisitorIdentities)
        .where(
          and(
            eq(schema.analyticsVisitorIdentities.orgId, orgId),
            eq(schema.analyticsVisitorIdentities.visitorId, input.visitorId.trim().slice(0, 64)),
          ),
        )
        .limit(1);
      if (linked[0]) {
        const row = await this.selectOne(eq(schema.endUsers.id, linked[0].endUserId), orgId);
        if (row) return this.toResolution(row, 'visitor-id');
      }
    }

    return { ...NO_MATCH };
  }

  async profile(endUserId: string): Promise<IdentityProfile> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    const row = await this.selectOne(eq(schema.endUsers.id, endUserId), orgId);
    if (!row) throw new NotFoundException(`identity_not_found: end user ${endUserId}`);

    const [conversations] = await ctx.db
      .select({
        count: countDistinct(schema.convConversations.id),
        lastAt: max(schema.convConversations.lastMessageAt),
        channels: sql<string[]>`coalesce(array_agg(distinct ${schema.convChannels.type}), '{}')`,
      })
      .from(schema.convConversations)
      .innerJoin(
        schema.convChannels,
        eq(schema.convChannels.id, schema.convConversations.channelId),
      )
      .where(
        and(
          eq(schema.convConversations.orgId, orgId),
          eq(schema.convConversations.endUserId, endUserId),
        ),
      );

    const visitors = await ctx.db
      .select({ visitorId: schema.analyticsVisitorIdentities.visitorId })
      .from(schema.analyticsVisitorIdentities)
      .where(
        and(
          eq(schema.analyticsVisitorIdentities.orgId, orgId),
          eq(schema.analyticsVisitorIdentities.endUserId, endUserId),
        ),
      );

    const [views] = await ctx.db
      .select({ count: countDistinct(schema.analyticsViewEvents.id) })
      .from(schema.analyticsViewEvents)
      .where(
        and(
          eq(schema.analyticsViewEvents.orgId, orgId),
          eq(schema.analyticsViewEvents.endUserId, endUserId),
        ),
      );

    const [searches] = await ctx.db
      .select({ count: countDistinct(schema.analyticsSearchEvents.id) })
      .from(schema.analyticsSearchEvents)
      .where(
        and(
          eq(schema.analyticsSearchEvents.orgId, orgId),
          eq(schema.analyticsSearchEvents.endUserId, endUserId),
        ),
      );

    const crmContact = await ctx.db
      .select({ id: schema.crmContacts.id })
      .from(schema.crmContacts)
      .where(
        and(eq(schema.crmContacts.orgId, orgId), eq(schema.crmContacts.endUserId, endUserId)),
      )
      .limit(1);

    const convContact = await ctx.db
      .select({ id: schema.convContacts.id })
      .from(schema.convContacts)
      .where(
        and(eq(schema.convContacts.orgId, orgId), eq(schema.convContacts.endUserId, endUserId)),
      )
      .limit(1);

    return {
      ...toDto(row),
      channels: (conversations?.channels ?? []).filter((c): c is string => Boolean(c)).sort(),
      conversationCount: Number(conversations?.count ?? 0),
      lastConversationAt: conversations?.lastAt ? new Date(conversations.lastAt).toISOString() : null,
      visitorIds: visitors.map((v) => v.visitorId),
      viewEventCount: Number(views?.count ?? 0),
      searchEventCount: Number(searches?.count ?? 0),
      crmContactId: crmContact[0]?.id ?? null,
      convContactId: convContact[0]?.id ?? null,
    };
  }

  async list(limit?: number): Promise<EndUserDto[]> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.endUsers)
      .where(eq(schema.endUsers.orgId, ctx.actor!.orgId))
      .orderBy(desc(schema.endUsers.createdAt))
      .limit(clampLimit(limit, 50, 200));
    return rows.map(toDto);
  }

  async get(id: string): Promise<EndUserDto> {
    const ctx = getCurrentContext();
    const row = await this.selectOne(eq(schema.endUsers.id, id), ctx.actor!.orgId);
    if (!row) throw new NotFoundException(`EndUser ${id} not found`);
    return toDto(row);
  }

  async findOrCreate(input: EndUserPatch): Promise<EndUserDto> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;

    if (input.externalId) {
      const existing = await this.selectOne(
        eq(schema.endUsers.externalId, input.externalId),
        orgId,
      );
      if (existing) return toDto(existing);
    }

    const [created] = await ctx.db
      .insert(schema.endUsers)
      .values({
        orgId,
        externalId: input.externalId ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        name: input.name ?? null,
        metadata: input.metadata ?? {},
      })
      .returning();
    await this.webhooks.emit({
      type: 'end_user.created',
      payload: {
        endUserId: created!.id,
        externalId: created!.externalId,
        email: created!.email,
      },
    });
    return toDto(created!);
  }

  async revokeTokens(endUserId: string): Promise<{ revoked: number }> {
    const ctx = getCurrentContext();
    const result = await ctx.db
      .update(schema.tokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.tokens.endUserId, endUserId),
          eq(schema.tokens.orgId, ctx.actor!.orgId),
          isNull(schema.tokens.revokedAt),
        ),
      )
      .returning({ id: schema.tokens.id });
    if (result.length > 0) {
      await this.webhooks.emit({
        type: 'end_user.tokens_revoked',
        payload: { endUserId, revoked: result.length },
      });
    }
    return { revoked: result.length };
  }

  private async selectOne(
    predicate: SQL,
    orgId: string,
  ): Promise<typeof schema.endUsers.$inferSelect | null> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.endUsers)
      .where(and(eq(schema.endUsers.orgId, orgId), predicate))
      .limit(1);
    return rows[0] ?? null;
  }

  private async toResolution(
    row: typeof schema.endUsers.$inferSelect,
    matchedOn: IdentityMatchKey,
  ): Promise<IdentityResolution> {
    const ctx = getCurrentContext();
    const crmContact = await ctx.db
      .select({ id: schema.crmContacts.id })
      .from(schema.crmContacts)
      .where(
        and(
          eq(schema.crmContacts.orgId, row.orgId),
          eq(schema.crmContacts.endUserId, row.id),
        ),
      )
      .limit(1);
    return {
      endUserId: row.id,
      matchedOn,
      externalId: row.externalId,
      email: row.email,
      phone: row.phone,
      name: row.name,
      firstSeenAt: row.createdAt.toISOString(),
      lastSeenAt: row.updatedAt.toISOString(),
      crmContactId: crmContact[0]?.id ?? null,
    };
  }
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), max);
}

export function toDto(row: typeof schema.endUsers.$inferSelect): EndUserDto {
  return {
    id: row.id,
    externalId: row.externalId,
    email: row.email,
    phone: row.phone,
    name: row.name,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
