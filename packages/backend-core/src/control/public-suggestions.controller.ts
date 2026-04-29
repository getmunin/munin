import { Controller, Get, Query } from '@nestjs/common';
import { schema, type Db } from '@munin/db';
import { and, desc, eq } from 'drizzle-orm';
import { Inject } from '@nestjs/common';
import { DB } from '../common/db/db.module.js';

interface PublicSuggestionDto {
  id: string;
  title: string;
  body: string;
  appScope: string | null;
  status: string;
  voteCount: number;
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Anonymous, read-only view of suggestions an org has explicitly published
 * to the community board. No auth required — this is a public marketing /
 * SEO surface and directly serves the OSS community-adoption goal.
 *
 * Authorship is intentionally not surfaced; the board is "what users want",
 * not "who wants what". Counts aggregate per-suggestion votes; we don't
 * dedupe across orgs because that would require persisting community-side
 * vote totals separately. Org-local vote counts are good enough for v0.4.
 */
@Controller('api/public/suggestions')
export class PublicSuggestionsController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async list(
    @Query('limit') limit?: string,
    @Query('appScope') appScope?: string,
    @Query('status') status?: string,
  ): Promise<PublicSuggestionDto[]> {
    const take = clampLimit(limit, DEFAULT_LIMIT, MAX_LIMIT);
    const filters = [eq(schema.suggestions.public, true)];
    if (appScope) filters.push(eq(schema.suggestions.appScope, appScope));
    if (status) filters.push(eq(schema.suggestions.status, status));

    const rows = await this.db
      .select({
        id: schema.suggestions.id,
        title: schema.suggestions.title,
        body: schema.suggestions.body,
        appScope: schema.suggestions.appScope,
        status: schema.suggestions.status,
        voteCount: schema.suggestions.voteCount,
        createdAt: schema.suggestions.createdAt,
        updatedAt: schema.suggestions.updatedAt,
      })
      .from(schema.suggestions)
      .where(and(...filters))
      .orderBy(desc(schema.suggestions.voteCount), desc(schema.suggestions.createdAt))
      .limit(take);

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      appScope: row.appScope,
      status: row.status,
      voteCount: row.voteCount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }
}

function clampLimit(value: string | undefined, fallback: number, max: number): number {
  const n = value ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}
