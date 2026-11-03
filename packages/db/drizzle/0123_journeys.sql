-- Journeys: a versioned graph that wraps one outreach campaign. journeys
-- holds lifecycle state; journey_versions holds each spec, immutable once
-- published_at is set. Runtime tables (enrollments, step runs, waits) arrive
-- with the runtime engine. Tenant isolation policies live in journeys.sql.
CREATE TABLE IF NOT EXISTS "journeys" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"outreach_campaign_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"live_version" integer,
	"next_entry_at" timestamp with time zone,
	"created_by_actor_type" varchar(16) NOT NULL,
	"created_by_actor_id" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journey_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"journey_id" text NOT NULL,
	"number" integer NOT NULL,
	"spec" jsonb NOT NULL,
	"spec_hash" varchar(64) NOT NULL,
	"parent_version" integer,
	"change_summary" text,
	"validation" jsonb,
	"created_by_actor_type" varchar(16) NOT NULL,
	"created_by_actor_id" text NOT NULL,
	"publish_fingerprint" varchar(64),
	"publish_requested_at" timestamp with time zone,
	"publish_requested_by_actor_type" varchar(16),
	"publish_requested_by_actor_id" text,
	"published_at" timestamp with time zone,
	"published_by_actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journeys" ADD CONSTRAINT "journeys_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journeys" ADD CONSTRAINT "journeys_outreach_campaign_id_outreach_campaigns_id_fk" FOREIGN KEY ("outreach_campaign_id") REFERENCES "public"."outreach_campaigns"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journey_versions" ADD CONSTRAINT "journey_versions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journey_versions" ADD CONSTRAINT "journey_versions_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "journeys_org_name_uq" ON "journeys" USING btree ("org_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "journeys_campaign_uq" ON "journeys" USING btree ("outreach_campaign_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journeys_next_entry_idx" ON "journeys" USING btree ("next_entry_at") WHERE status = 'live';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "journey_versions_number_uq" ON "journey_versions" USING btree ("journey_id","number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journey_versions_org_idx" ON "journey_versions" USING btree ("org_id");
