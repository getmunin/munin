ALTER TABLE "outreach_campaigns" ADD COLUMN "sequence_steps" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_proposals" ADD COLUMN "sequence_step" integer;