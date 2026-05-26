import { Injectable, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { getCurrentContext, type Audience } from '@getmunin/core';
import { EmbeddingProviderHolder } from './embedding.provider.ts';

export interface SearchHit {
  documentId: string;
  spaceId: string;
  title: string;
  excerpt: string;
  audiences: Audience[];
  score: number;
  source: 'fts' | 'vector' | 'both';
}

export interface SearchInput {
  query: string;
  spaceId?: string;
  limit?: number;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const RRF_K = 60;
const VECTOR_CANDIDATES = 50;
const FTS_CANDIDATES = 50;

type FtsRow = {
  document_id: string;
  space_id: string;
  title: string;
  audiences: Audience[];
  excerpt: string;
  rank: number;
  rn: number;
} & Record<string, unknown>;

type VectorRow = {
  document_id: string;
  space_id: string;
  title: string;
  audiences: Audience[];
  excerpt: string;
  similarity: number;
  rn: number;
} & Record<string, unknown>;

@Injectable()
export class KbSearchService {
  constructor(
    @Inject(EmbeddingProviderHolder) private readonly embeddings: EmbeddingProviderHolder,
  ) {}

  /**
   * Hybrid search: FTS over title+body and chunk content, vector cosine over
   * chunk embeddings. Per-source ranks are combined via Reciprocal Rank Fusion
   * (RRF, k=60) so each source contributes monotonic, scale-free votes.
   *
   * RLS enforces tenancy + the audiences filter for self-service callers
   * (only docs whose audiences include 'self_service' surface to end-users).
   * Caller-passed filters (spaceId) are also AND'd in the SQL.
   */
  async search(input: SearchInput): Promise<SearchHit[]> {
    const ctx = getCurrentContext();
    const limit = clampLimit(input.limit, DEFAULT_LIMIT, MAX_LIMIT);
    const trimmed = input.query.trim();
    if (!trimmed) return [];

    const ftsRows = await ctx.db.execute<FtsRow>(sql`
      WITH q AS (SELECT websearch_to_tsquery('english', ${trimmed}) AS tsq),
      ranked AS (
        SELECT
          d.id            AS document_id,
          d.space_id      AS space_id,
          d.title         AS title,
          d.audiences     AS audiences,
          ts_headline('english', left(d.body, 600), q.tsq,
            'StartSel=,StopSel=,MaxWords=40,MinWords=15,ShortWord=3') AS excerpt,
          ts_rank_cd(d.fts, q.tsq) AS rank,
          ROW_NUMBER() OVER (ORDER BY ts_rank_cd(d.fts, q.tsq) DESC) AS rn
        FROM kb_documents d, q
        WHERE d.fts @@ q.tsq
          ${input.spaceId ? sql`AND d.space_id = ${input.spaceId}` : sql``}
      )
      SELECT * FROM ranked
      WHERE rank > 0
      ORDER BY rank DESC
      LIMIT ${FTS_CANDIDATES}
    `);

    const [queryVec] = await this.embeddings.get().embed([trimmed]);
    const vectorRows = queryVec
      ? await ctx.db.execute<VectorRow>(sql`
          WITH ranked AS (
            SELECT
              d.id            AS document_id,
              d.space_id      AS space_id,
              d.title         AS title,
              d.audiences     AS audiences,
              left(c.content, 400) AS excerpt,
              1 - (c.embedding <=> ${formatVector(queryVec)}::vector) AS similarity,
              ROW_NUMBER() OVER (
                PARTITION BY c.document_id
                ORDER BY c.embedding <=> ${formatVector(queryVec)}::vector ASC
              ) AS chunk_rn
            FROM kb_document_chunks c
            JOIN kb_documents d ON d.id = c.document_id
            WHERE c.embedding IS NOT NULL
              ${input.spaceId ? sql`AND d.space_id = ${input.spaceId}` : sql``}
          )
          SELECT
            document_id, space_id, title, audiences, excerpt, similarity,
            ROW_NUMBER() OVER (ORDER BY similarity DESC) AS rn
          FROM ranked
          WHERE chunk_rn = 1
          ORDER BY similarity DESC
          LIMIT ${VECTOR_CANDIDATES}
        `)
      : [];

    return reciprocalRankFuse(ftsRows, vectorRows, limit);
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

  for (const row of ftsRows) {
    const score = 1 / (RRF_K + row.rn);
    merged.set(row.document_id, {
      hit: {
        documentId: row.document_id,
        spaceId: row.space_id,
        title: row.title,
        excerpt: row.excerpt,
        audiences: row.audiences,
      },
      ftsScore: score,
      vectorScore: 0,
    });
  }
  for (const row of vectorRows) {
    const score = 1 / (RRF_K + row.rn);
    const existing = merged.get(row.document_id);
    if (existing) {
      existing.vectorScore = score;
      // Prefer FTS excerpt if available (highlights matched terms), else use
      // the vector excerpt (the most-similar chunk).
      if (!existing.hit.excerpt) existing.hit.excerpt = row.excerpt;
    } else {
      merged.set(row.document_id, {
        hit: {
          documentId: row.document_id,
          spaceId: row.space_id,
          title: row.title,
          excerpt: row.excerpt,
          audiences: row.audiences,
        },
        ftsScore: 0,
        vectorScore: score,
      });
    }
  }

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
