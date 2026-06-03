---
'@getmunin/core': patch
'@getmunin/backend-core': patch
---

KB and CMS vector search now cast the query embedding to match the deployed column type. The hard-coded `::vector` cast in `kb.search.ts` and `cms.search.ts` bypassed the HNSW index when the column was switched to `halfvec` (required for embeddings above 2000 dimensions, since pgvector's `vector` type caps HNSW indexing at 2000). Queries fell back to sequential scans of every chunk in the org. A new `embeddingColumnType()` helper in `@getmunin/core` reads `MUNIN_EMBEDDING_COLUMN_TYPE` (defaulting to `vector`), and the search SQL uses it via `sql.raw` to keep the index in play. Set `MUNIN_EMBEDDING_COLUMN_TYPE=halfvec` on deployments where the column was migrated to `halfvec`.
