ALTER TABLE "kb_documents"
  ADD COLUMN IF NOT EXISTS "is_system" boolean NOT NULL DEFAULT false;
