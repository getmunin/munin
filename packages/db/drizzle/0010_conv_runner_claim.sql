ALTER TABLE "conv_conversations"
  ADD COLUMN IF NOT EXISTS "runner_holder" text,
  ADD COLUMN IF NOT EXISTS "runner_lease_expires_at" timestamp with time zone;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "conv_conversations_runner_lease_idx"
  ON "conv_conversations" ("runner_lease_expires_at")
  WHERE "runner_holder" IS NOT NULL;
