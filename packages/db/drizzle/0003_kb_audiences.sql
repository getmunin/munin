-- Replace kb_documents.public (boolean) with kb_documents.audiences (jsonb
-- array), matching the audience model used by skills + the rest of MCP. The
-- old `public` flag was a half-baked toggle: there's no anonymous KB
-- delivery endpoint, so what it actually controlled was whether a
-- self-service-audience caller could see the doc. Renaming makes that
-- explicit and lets us hold both audiences (or only one) per doc.
--
-- Mapping:
--   public = false  →  audiences = ['admin']
--   public = true   →  audiences = ['admin', 'self_service']
--
-- Same column added to kb_document_versions so historical snapshots keep
-- the right visibility on restore.

ALTER TABLE "kb_documents"
  ADD COLUMN "audiences" jsonb NOT NULL DEFAULT '["admin"]'::jsonb;
--> statement-breakpoint

UPDATE "kb_documents"
SET "audiences" = CASE
  WHEN "public" = true THEN '["admin","self_service"]'::jsonb
  ELSE '["admin"]'::jsonb
END;
--> statement-breakpoint

DROP INDEX IF EXISTS "kb_documents_public_idx";
--> statement-breakpoint

CREATE INDEX "kb_documents_audiences_idx"
  ON "kb_documents" USING gin ("audiences");
--> statement-breakpoint

ALTER TABLE "kb_documents" DROP COLUMN "public";
--> statement-breakpoint

ALTER TABLE "kb_document_versions"
  ADD COLUMN "audiences" jsonb NOT NULL DEFAULT '["admin"]'::jsonb;
--> statement-breakpoint

UPDATE "kb_document_versions"
SET "audiences" = CASE
  WHEN "public" = true THEN '["admin","self_service"]'::jsonb
  ELSE '["admin"]'::jsonb
END;
--> statement-breakpoint

ALTER TABLE "kb_document_versions" DROP COLUMN "public";
