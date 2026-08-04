ALTER TABLE "conv_conversations" ADD COLUMN IF NOT EXISTS "handover_resolved_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conv_conversations_handover_resolved_idx" ON "conv_conversations" USING btree ("org_id","handover_resolved_at") WHERE handover_resolved_at IS NOT NULL;
