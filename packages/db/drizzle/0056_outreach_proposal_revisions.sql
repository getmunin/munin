ALTER TABLE "outreach_proposals" ADD COLUMN "first_viewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outreach_proposals" ADD COLUMN "viewed_by_actor_type" varchar(16);--> statement-breakpoint
ALTER TABLE "outreach_proposals" ADD COLUMN "viewed_by_actor_id" text;--> statement-breakpoint
ALTER TABLE "outreach_proposals" ADD COLUMN "revision_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_proposals" ADD COLUMN "last_revised_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outreach_proposals" ADD COLUMN "last_revision_reason" text;--> statement-breakpoint
ALTER TABLE "outreach_proposals" ADD COLUMN "revised_by_actor_type" varchar(16);--> statement-breakpoint
ALTER TABLE "outreach_proposals" ADD COLUMN "revised_by_actor_id" text;--> statement-breakpoint
ALTER TABLE "outreach_proposals" ADD COLUMN "revised_after_review_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outreach_proposals" ADD COLUMN "withdraw_reason" text;