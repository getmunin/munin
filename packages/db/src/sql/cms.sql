-- ============================================================================
-- Munin CMS extras: full-text search, HNSW vector index, and RLS policies.
-- Applied during migrations after Drizzle schema and base RLS.
--
-- Drizzle does not natively model generated tsvector columns or specialized
-- index types (HNSW, GIN/tsvector), so they live here in idempotent SQL.
-- ============================================================================

-- ───────────────────────── FTS column on cms_entries ──────────────────────
-- Generated tsvector built from search_text (which CmsService populates by
-- concatenating searchable fields per the collection's settings).
ALTER TABLE cms_entries
  ADD COLUMN IF NOT EXISTS fts tsvector
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(search_text, ''))) STORED;

CREATE INDEX IF NOT EXISTS cms_entries_fts_idx
  ON cms_entries USING gin (fts);

-- ───────────────────────── HNSW vector index ──────────────────────────────
-- Cosine similarity for hybrid search. Pairs with the embedding column on
-- cms_entries; reads use `1 - (embedding <=> q)` for similarity.
CREATE INDEX IF NOT EXISTS cms_entries_embedding_hnsw_idx
  ON cms_entries USING hnsw (embedding vector_cosine_ops);

-- ───────────────────────── CMS RLS ────────────────────────────────────────
-- Collections, locales, assets, references: org-scoped, admin-only. End-
-- user audience never sees CMS internals; the public delivery surface goes
-- through a separate service-role controller that hard-filters on
-- status='published' (mirroring the public-suggestions pattern).

ALTER TABLE cms_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_collections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON cms_collections;
CREATE POLICY tenant_isolation ON cms_collections
  USING (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

ALTER TABLE cms_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON cms_entries;
CREATE POLICY tenant_isolation ON cms_entries
  USING (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

ALTER TABLE cms_entry_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_entry_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON cms_entry_versions;
CREATE POLICY tenant_isolation ON cms_entry_versions
  USING (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

ALTER TABLE cms_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_assets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON cms_assets;
CREATE POLICY tenant_isolation ON cms_assets
  USING (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

ALTER TABLE cms_locales ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_locales FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON cms_locales;
CREATE POLICY tenant_isolation ON cms_locales
  USING (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

ALTER TABLE cms_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_references FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON cms_references;
CREATE POLICY tenant_isolation ON cms_references
  USING (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
