-- A KB document's canonical URL, as a property instead of a label.
--
-- The website importer used to record where a page came from as a
-- `source-url:<url>` tag, a convention private to web-import.handler.ts. Nothing
-- else could read it: kb_search returns no tags at all, and prefix-parsing a
-- jsonb array is not a contract we want agents to depend on for citations. This
-- promotes it to a column so search hits and reads carry the URL directly.
--
-- Backfill lifts the tag into the column for documents imported before this ran.
-- The tag itself is left in place: the importer keeps reading it as a fallback
-- for one release, and the next re-import rewrites tags without it.
--
-- kb_documents is FORCE ROW LEVEL SECURITY and the app connects as the
-- non-superuser munin_app role, so the backfill needs the bypass GUC or it
-- silently updates nothing on a real deploy.
ALTER TABLE "kb_documents" ADD COLUMN IF NOT EXISTS "source_url" text;--> statement-breakpoint

DO $$
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);

  UPDATE "kb_documents" AS d
  SET "source_url" = t.url
  FROM (
    SELECT DISTINCT ON (d2."id")
      d2."id" AS id,
      btrim(substr(tag, length('source-url:') + 1)) AS url
    FROM "kb_documents" d2
    CROSS JOIN LATERAL jsonb_array_elements_text(d2."tags") AS tag
    WHERE tag LIKE 'source-url:%'
    ORDER BY d2."id", tag
  ) AS t
  WHERE d."id" = t.id
    AND d."source_url" IS NULL
    AND t.url <> '';
END $$;
