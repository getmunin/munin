-- Per-agent attribution: record which OAuth client the credential belonged to.
-- actor_id is the authorizing user for OAuth callers, so two connectors held by
-- the same user were previously indistinguishable in audit_log.
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "client_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_client_idx" ON "audit_log" USING btree ("org_id","client_id","created_at");
