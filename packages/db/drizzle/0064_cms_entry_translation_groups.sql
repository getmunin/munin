-- Locale variants of one piece of content used to be linked only by sharing a
-- slug, which is exactly what blocked per-locale slugs. translation_group_id
-- makes the link explicit so the slugs can diverge.
ALTER TABLE "cms_entries" ADD COLUMN IF NOT EXISTS "translation_group_id" text;--> statement-breakpoint
-- Backfill the old convention: rows sharing (collection, slug) were siblings.
-- Derived from the pair rather than random so re-running is a no-op and every
-- environment computes the same group ids. bypass_rls because cms_entries is
-- FORCE ROW LEVEL SECURITY and no app.org_id is set during a migration.
DO $$
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);

  UPDATE cms_entries
     SET translation_group_id = 'cmg_' || substr(md5(collection_id || ':' || slug), 1, 22)
   WHERE translation_group_id IS NULL;
END $$;--> statement-breakpoint
ALTER TABLE "cms_entries" ALTER COLUMN "translation_group_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cms_entries_translation_group_locale_uq" ON "cms_entries" USING btree ("org_id","translation_group_id","locale");
