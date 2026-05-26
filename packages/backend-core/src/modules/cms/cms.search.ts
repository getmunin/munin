import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL, and, eq } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import type { Db, Tx } from '@getmunin/db';
import { schema } from '@getmunin/db';
import { DB } from '../../common/db/db.module.ts';
import { EmbeddingProviderHolder } from '../kb/embedding.provider.ts';
import { CmsService, type EntryStatus } from './cms.service.ts';
import type { FieldDef } from './cms.fields.ts';
import { projectData } from './cms.fields.ts';

export interface SearchHit {
  entryId: string;
  collectionId: string;
  collectionSlug: string;
  slug: string;
  locale: string;
  status: EntryStatus;
  data: Record<string, unknown>;
  excerpt: string;
  score: number;
  source: 'fts' | 'vector' | 'both';
}

export interface SearchInput {
  query: string;
  collection?: string;
  status?: EntryStatus;
  locale?: string;
  /** Public-only filter (delivery API). Admin search includes drafts + scheduled. */
  publishedOnly?: boolean;
  limit?: number;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const RRF_K = 60;
const VECTOR_CANDIDATES = 50;
const FTS_CANDIDATES = 50;

type FtsRow = {
  entry_id: string;
  collection_id: string;
  collection_slug: string;
  slug: string;
  locale: string;
  status: string;
  data: Record<string, unknown>;
  fields: FieldDef[];
  excerpt: string;
  rank: number;
  rn: number;
} & Record<string, unknown>;

type VectorRow = {
  entry_id: string;
  collection_id: string;
  collection_slug: string;
  slug: string;
  locale: string;
  status: string;
  data: Record<string, unknown>;
  fields: FieldDef[];
  excerpt: string;
  similarity: number;
  rn: number;
} & Record<string, unknown>;

@Injectable()
export class CmsSearchService {
  constructor(
    @Inject(EmbeddingProviderHolder) private readonly embeddings: EmbeddingProviderHolder,
    @Inject(CmsService) private readonly cms: CmsService,
    @Inject(DB) private readonly serviceDb: Db,
  ) {}

  /**
   * Hybrid search across CMS entries. FTS over the generated tsvector
   * (`fts`) plus pgvector cosine over `embedding`, fused via Reciprocal
   * Rank Fusion (k=60).
   *
   * Admin callers (RLS-scoped to org) see drafts + published. The public
   * delivery surface passes `publishedOnly: true` + opts.orgId and runs
   * against the service-role DB so RLS doesn't gate the read; cross-org
   * leakage is impossible because the SQL hard-filters on org_id.
   */
  async search(input: SearchInput, opts?: { orgId?: string }): Promise<SearchHit[]> {
    const limit = clampLimit(input.limit, DEFAULT_LIMIT, MAX_LIMIT);
    const trimmed = input.query.trim();
    if (!trimmed) return [];

    // Public path uses the service-role DB (no request context); admin path
    // uses the tenant-bound transaction Db from the request context.
    const db: Db | Tx = opts?.orgId ? this.serviceDb : getCurrentContext().db;

    const filters: SQL[] = [];
    if (opts?.orgId) {
      filters.push(sql`e.org_id = ${opts.orgId}`);
    }
    if (input.collection) {
      const col = opts?.orgId
        ? await this.lookupCollection(db, opts.orgId, input.collection)
        : await this.cms.getCollection(input.collection);
      if (!col) return [];
      filters.push(sql`e.collection_id = ${col.id}`);
    }
    if (input.status && !input.publishedOnly) {
      filters.push(sql`e.status = ${input.status}`);
    }
    if (input.publishedOnly) {
      filters.push(sql`e.status = 'published'`);
    }
    if (input.locale) {
      filters.push(sql`e.locale = ${input.locale}`);
    }
    const whereExpr =
      filters.length === 0
        ? sql`TRUE`
        : sql.join(filters, sql` AND `);

    const ftsRows = await db.execute<FtsRow>(sql`
      WITH q AS (SELECT websearch_to_tsquery('english', ${trimmed}) AS tsq),
      ranked AS (
        SELECT
          e.id              AS entry_id,
          e.collection_id   AS collection_id,
          c.slug            AS collection_slug,
          e.slug            AS slug,
          e.locale          AS locale,
          e.status          AS status,
          e.data            AS data,
          c.fields          AS fields,
          ts_headline('english', left(e.search_text, 600), q.tsq,
            'StartSel=,StopSel=,MaxWords=40,MinWords=15,ShortWord=3') AS excerpt,
          ts_rank_cd(e.fts, q.tsq) AS rank,
          ROW_NUMBER() OVER (ORDER BY ts_rank_cd(e.fts, q.tsq) DESC) AS rn
        FROM cms_entries e
        JOIN cms_collections c ON c.id = e.collection_id,
        q
        WHERE e.fts @@ q.tsq AND ${whereExpr}
      )
      SELECT * FROM ranked WHERE rank > 0 ORDER BY rank DESC LIMIT ${FTS_CANDIDATES}
    `);

    const [queryVec] = await this.embeddings.get().embed([trimmed]);
    const vectorRows = queryVec
      ? await db.execute<VectorRow>(sql`
          SELECT
            e.id              AS entry_id,
            e.collection_id   AS collection_id,
            c.slug            AS collection_slug,
            e.slug            AS slug,
            e.locale          AS locale,
            e.status          AS status,
            e.data            AS data,
            c.fields          AS fields,
            left(e.search_text, 400) AS excerpt,
            1 - (e.embedding <=> ${formatVector(queryVec)}::vector) AS similarity,
            ROW_NUMBER() OVER (ORDER BY e.embedding <=> ${formatVector(queryVec)}::vector ASC) AS rn
          FROM cms_entries e
          JOIN cms_collections c ON c.id = e.collection_id
          WHERE e.embedding IS NOT NULL AND ${whereExpr}
          ORDER BY similarity DESC
          LIMIT ${VECTOR_CANDIDATES}
        `)
      : [];

    return reciprocalRankFuse(ftsRows, vectorRows, limit);
  }

  private async lookupCollection(
    db: Db | Tx,
    orgId: string,
    idOrSlug: string,
  ): Promise<{ id: string } | null> {
    const rows = await db
      .select({ id: schema.cmsCollections.id })
      .from(schema.cmsCollections)
      .where(
        and(
          eq(schema.cmsCollections.orgId, orgId),
          sql`(${schema.cmsCollections.id} = ${idOrSlug} OR ${schema.cmsCollections.slug} = ${idOrSlug})`,
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }
}

function reciprocalRankFuse(
  ftsRows: readonly FtsRow[],
  vectorRows: readonly VectorRow[],
  limit: number,
): SearchHit[] {
  const merged = new Map<
    string,
    {
      hit: Omit<SearchHit, 'score' | 'source'>;
      ftsScore: number;
      vectorScore: number;
    }
  >();

  function recordHit(
    row: FtsRow | VectorRow,
    score: number,
    isFts: boolean,
  ): void {
    const existing = merged.get(row.entry_id);
    if (existing) {
      if (isFts) existing.ftsScore = score;
      else existing.vectorScore = score;
      if (!existing.hit.excerpt) existing.hit.excerpt = row.excerpt;
      return;
    }
    merged.set(row.entry_id, {
      hit: {
        entryId: row.entry_id,
        collectionId: row.collection_id,
        collectionSlug: row.collection_slug,
        slug: row.slug,
        locale: row.locale,
        status: row.status as EntryStatus,
        data: projectData(row.fields, row.data),
        excerpt: row.excerpt,
      },
      ftsScore: isFts ? score : 0,
      vectorScore: isFts ? 0 : score,
    });
  }

  for (const row of ftsRows) recordHit(row, 1 / (RRF_K + row.rn), true);
  for (const row of vectorRows) recordHit(row, 1 / (RRF_K + row.rn), false);

  return [...merged.values()]
    .map(({ hit, ftsScore, vectorScore }): SearchHit => ({
      ...hit,
      score: ftsScore + vectorScore,
      source: ftsScore > 0 && vectorScore > 0 ? 'both' : ftsScore > 0 ? 'fts' : 'vector',
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function formatVector(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || value <= 0) return fallback;
  return Math.min(value, max);
}
