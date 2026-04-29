import { Injectable } from '@nestjs/common';
import { schema } from '@munin/db';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { getCurrentContext } from '@munin/core';

const APP_SCOPES = ['kb', 'conv', 'crm', 'core'] as const;
const STATUSES = ['open', 'planned', 'in_progress', 'done', 'wontfix', 'duplicate'] as const;

export type SuggestionAppScope = (typeof APP_SCOPES)[number];
export type SuggestionStatus = (typeof STATUSES)[number];

export class SuggestionsRateLimitError extends Error {
  readonly code = 'suggestions_rate_limit';
  constructor() {
    super('suggestions_rate_limit: too many suggestions created in the last hour for this org');
  }
}

export class SuggestionsNotFoundError extends Error {
  readonly code = 'suggestions_not_found';
  constructor(id: string) {
    super(`suggestions_not_found: no suggestion with id ${id}`);
  }
}

export interface SuggestionDto {
  id: string;
  title: string;
  body: string;
  appScope: SuggestionAppScope | null;
  status: SuggestionStatus;
  voteCount: number;
  public: boolean;
  createdAt: string;
  updatedAt: string;
}

const HOURLY_CREATE_LIMIT = 25;

@Injectable()
export class SuggestionsService {
  async search(input: {
    query: string;
    appScope?: SuggestionAppScope;
    status?: SuggestionStatus;
    limit?: number;
  }): Promise<SuggestionDto[]> {
    const ctx = getCurrentContext();
    const limit = clamp(input.limit, 10, 50);
    const trimmed = input.query.trim();
    if (!trimmed) return [];

    const filters = [
      or(ilike(schema.suggestions.title, `%${trimmed}%`), ilike(schema.suggestions.body, `%${trimmed}%`)),
    ];
    if (input.appScope) filters.push(eq(schema.suggestions.appScope, input.appScope));
    if (input.status) filters.push(eq(schema.suggestions.status, input.status));

    const rows = await ctx.db
      .select()
      .from(schema.suggestions)
      .where(and(...filters))
      .orderBy(desc(schema.suggestions.voteCount), desc(schema.suggestions.createdAt))
      .limit(limit);
    return rows.map(toDto);
  }

  async list(input: {
    status?: SuggestionStatus;
    appScope?: SuggestionAppScope;
    sort?: 'votes' | 'recent';
    limit?: number;
  }): Promise<SuggestionDto[]> {
    const ctx = getCurrentContext();
    const limit = clamp(input.limit, 25, 100);
    const filters = [];
    if (input.status) filters.push(eq(schema.suggestions.status, input.status));
    if (input.appScope) filters.push(eq(schema.suggestions.appScope, input.appScope));
    const orderBy =
      input.sort === 'recent'
        ? [desc(schema.suggestions.createdAt)]
        : [desc(schema.suggestions.voteCount), desc(schema.suggestions.createdAt)];

    const rows = await ctx.db
      .select()
      .from(schema.suggestions)
      .where(filters.length === 0 ? undefined : and(...filters))
      .orderBy(...orderBy)
      .limit(limit);
    return rows.map(toDto);
  }

  async get(id: string): Promise<SuggestionDto> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.suggestions)
      .where(eq(schema.suggestions.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) throw new SuggestionsNotFoundError(id);
    return toDto(row);
  }

  async create(input: {
    title: string;
    body: string;
    appScope?: SuggestionAppScope;
  }): Promise<SuggestionDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    await this.assertCreateAllowed(actor.orgId);

    const [row] = await ctx.db
      .insert(schema.suggestions)
      .values({
        orgId: actor.orgId,
        title: input.title,
        body: input.body,
        appScope: input.appScope ?? null,
        status: 'open',
        createdByType: actor.type === 'user' ? 'user' : 'agent',
        createdById: actor.id,
        voteCount: 1,
      })
      .returning();
    // Author auto-votes for their own suggestion.
    await ctx.db.insert(schema.votes).values({
      suggestionId: row!.id,
      voterType: actor.type === 'user' ? 'user' : 'agent',
      voterId: actor.id,
      comment: null,
    });
    return toDto(row!);
  }

  async vote(input: { id: string; comment?: string }): Promise<SuggestionDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const existing = await ctx.db
      .select()
      .from(schema.suggestions)
      .where(eq(schema.suggestions.id, input.id))
      .limit(1);
    const sug = existing[0];
    if (!sug) throw new SuggestionsNotFoundError(input.id);

    const voterType = actor.type === 'user' ? 'user' : 'agent';
    const result = await ctx.db
      .insert(schema.votes)
      .values({
        suggestionId: input.id,
        voterType,
        voterId: actor.id,
        comment: input.comment ?? null,
      })
      .onConflictDoNothing()
      .returning({ suggestionId: schema.votes.suggestionId });

    if (result.length > 0) {
      await ctx.db
        .update(schema.suggestions)
        .set({ voteCount: sug.voteCount + 1, updatedAt: new Date() })
        .where(eq(schema.suggestions.id, input.id));
    }

    const refreshed = await ctx.db
      .select()
      .from(schema.suggestions)
      .where(eq(schema.suggestions.id, input.id))
      .limit(1);
    return toDto(refreshed[0]!);
  }

  private async assertCreateAllowed(orgId: string): Promise<void> {
    const ctx = getCurrentContext();
    const rows = await ctx.db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n
      FROM suggestions
      WHERE org_id = ${orgId}
        AND created_at > now() - interval '1 hour'
    `);
    if ((rows[0]?.n ?? 0) >= HOURLY_CREATE_LIMIT) {
      throw new SuggestionsRateLimitError();
    }
  }
}

function toDto(row: typeof schema.suggestions.$inferSelect): SuggestionDto {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    appScope: (row.appScope as SuggestionAppScope | null) ?? null,
    status: row.status as SuggestionStatus,
    voteCount: row.voteCount,
    public: row.public,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function clamp(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || value <= 0) return fallback;
  return Math.min(value, max);
}

export { APP_SCOPES, STATUSES };
