-- Social post drafts: the reviewable unit behind both the companion-post flow
-- and the generic "share this text" tool. A one-off share is a set of one, so
-- set_id is NOT NULL and there is no parent table to keep in step.
--
-- source_ref is denormalised across a set on purpose: the review queue groups
-- by set_id and every read path stays single-table.
--
-- Written idempotently so a corrected journal timestamp can re-run it.

CREATE TABLE IF NOT EXISTS "social_post_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"platform" varchar(16) NOT NULL,
	"set_id" text NOT NULL,
	"variant_label" varchar(32) NOT NULL,
	"body" text NOT NULL,
	"link_url" text,
	"link_utm" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_ref" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"suggested_user_id" text,
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"proposed_by_actor_type" varchar(16) NOT NULL,
	"proposed_by_actor_id" text NOT NULL,
	"decided_by_actor_type" varchar(16),
	"decided_by_actor_id" text,
	"decided_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"external_post_id" text,
	"permalink" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_post_drafts_org_id_orgs_id_fk') THEN
    ALTER TABLE "social_post_drafts" ADD CONSTRAINT "social_post_drafts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_post_drafts_suggested_user_id_users_id_fk') THEN
    ALTER TABLE "social_post_drafts" ADD CONSTRAINT "social_post_drafts_suggested_user_id_users_id_fk" FOREIGN KEY ("suggested_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_post_drafts_org_set_idx" ON "social_post_drafts" USING btree ("org_id","set_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_post_drafts_org_status_idx" ON "social_post_drafts" USING btree ("org_id","status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_post_drafts_org_created_idx" ON "social_post_drafts" USING btree ("org_id","created_at");
--> statement-breakpoint

-- Enum-shaped columns are guarded here rather than in schema.ts, matching
-- org_alerts. Drizzle cannot see these, so adding a platform or a status in
-- TypeScript means editing a migration too — that asymmetry is the cost of
-- having the database reject a bad value at all.
ALTER TABLE "social_post_drafts" DROP CONSTRAINT IF EXISTS "social_post_drafts_platform_chk";--> statement-breakpoint
ALTER TABLE "social_post_drafts" ADD CONSTRAINT "social_post_drafts_platform_chk"
    CHECK ("platform" IN ('linkedin'));--> statement-breakpoint
ALTER TABLE "social_post_drafts" DROP CONSTRAINT IF EXISTS "social_post_drafts_status_chk";--> statement-breakpoint
ALTER TABLE "social_post_drafts" ADD CONSTRAINT "social_post_drafts_status_chk"
    CHECK ("status" IN ('pending', 'published', 'published_externally', 'dismissed', 'failed'));
