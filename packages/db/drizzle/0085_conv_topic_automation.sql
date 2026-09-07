ALTER TABLE "conv_topics" ADD COLUMN IF NOT EXISTS "agent_mode" varchar(16);--> statement-breakpoint
ALTER TABLE "conv_topics" ADD COLUMN IF NOT EXISTS "auto_promoted_at" timestamp with time zone;