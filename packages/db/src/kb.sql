-- ============================================================================
-- Munin KB extras: full-text search column, search-side indexes, and RLS
-- policies. Applied during migrations after Drizzle schema + base RLS.
--
-- Drizzle does not natively model generated tsvector columns or specialized
-- index types (HNSW, GIN/tsvector), so they live here in idempotent SQL.
-- ============================================================================

-- ───────────────────────── FTS column on kb_documents ──────────────────────
-- Generated tsvector built from title (weighted A) + body (weighted B). English
-- config is fine for v0.4 — bootstrap can offer locale toggle later.
ALTER TABLE kb_documents
  ADD COLUMN IF NOT EXISTS fts tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(body,  '')), 'B')
    ) STORED;

CREATE INDEX IF NOT EXISTS kb_documents_fts_idx
  ON kb_documents USING gin (fts);

-- Same FTS column on chunks so we can rank at chunk granularity (search hits
-- highlight the matching chunk, not just the doc).
ALTER TABLE kb_document_chunks
  ADD COLUMN IF NOT EXISTS fts tsvector
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED;

CREATE INDEX IF NOT EXISTS kb_chunks_fts_idx
  ON kb_document_chunks USING gin (fts);

-- ───────────────────────── HNSW vector index ───────────────────────────────
-- Cosine distance — pairs with `1 - (embedding <=> query)` similarity in
-- queries. m=16, ef_construction=64 are pgvector defaults (good enough for
-- corpus sizes we expect through v0.5).
CREATE INDEX IF NOT EXISTS kb_chunks_embedding_hnsw_idx
  ON kb_document_chunks USING hnsw (embedding vector_cosine_ops);

-- ───────────────────────── KB RLS policies ─────────────────────────────────
-- All KB tables are org-scoped. Documents have an additional `public` flag
-- consulted by self-service callers (when app.end_user_id is set, only
-- public docs are visible). Chunks/versions inherit visibility from their
-- parent document — a tighter sub-policy avoids leaking embedding text via
-- direct chunk reads.

ALTER TABLE kb_spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_spaces FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON kb_spaces;
CREATE POLICY tenant_isolation ON kb_spaces
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

ALTER TABLE kb_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON kb_documents;
CREATE POLICY tenant_isolation ON kb_documents
  USING (
    app_bypass_rls()
    OR (
      org_id = app_org_id()
      AND (app_end_user_id() = '' OR public = true)
    )
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

ALTER TABLE kb_document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_document_chunks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON kb_document_chunks;
CREATE POLICY tenant_isolation ON kb_document_chunks
  USING (
    app_bypass_rls()
    OR (
      org_id = app_org_id()
      AND (
        app_end_user_id() = ''
        OR EXISTS (
          SELECT 1 FROM kb_documents d
          WHERE d.id = kb_document_chunks.document_id
            AND d.public = true
        )
      )
    )
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

ALTER TABLE kb_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_document_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON kb_document_versions;
CREATE POLICY tenant_isolation ON kb_document_versions
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
