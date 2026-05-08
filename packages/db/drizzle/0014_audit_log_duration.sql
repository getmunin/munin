ALTER TABLE "audit_log"
  ADD COLUMN IF NOT EXISTS "duration_ms" integer;
