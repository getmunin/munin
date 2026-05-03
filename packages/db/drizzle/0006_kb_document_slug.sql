ALTER TABLE "kb_documents"
  ADD COLUMN "slug" varchar(64);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "kb_documents_space_slug_uq"
  ON "kb_documents" ("space_id", "slug")
  WHERE "slug" IS NOT NULL;
