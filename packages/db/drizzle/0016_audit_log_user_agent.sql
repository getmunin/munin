ALTER TABLE "audit_log"
  ADD COLUMN IF NOT EXISTS "user_agent" text;
