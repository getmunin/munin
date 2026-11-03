-- Journey runtime: one enrollment per person per run, one step run per node
-- visit (the idempotency key and explanation trail), open waits for timers
-- and events, and an inbox that JourneyEventSink fills inside the emitting
-- transaction. Tenant isolation policies live in journeys.sql.
CREATE TABLE IF NOT EXISTS "journey_enrollments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"journey_id" text NOT NULL,
	"version" integer NOT NULL,
	"contact_id" text,
	"end_user_id" text,
	"subject_key" varchar(80) NOT NULL,
	"state" varchar(16) DEFAULT 'active' NOT NULL,
	"current_node" varchar(48),
	"visits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"conversation_id" text,
	"holdout" boolean DEFAULT false NOT NULL,
	"source" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_run_at" timestamp with time zone,
	"idle_deadline_at" timestamp with time zone,
	"goal_reached_at" timestamp with time zone,
	"exited_at" timestamp with time zone,
	"exit_reason" varchar(48),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journey_step_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"enrollment_id" text NOT NULL,
	"node_id" varchar(48) NOT NULL,
	"node_type" varchar(16) NOT NULL,
	"visit" integer NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" varchar(16) NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"edge_taken" varchar(64),
	"reason" text,
	"proposal_id" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journey_waits" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"enrollment_id" text NOT NULL,
	"step_run_id" text NOT NULL,
	"kind" varchar(24) NOT NULL,
	"wake_at" timestamp with time zone,
	"event_key" varchar(96),
	"match" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"timeout_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolution" varchar(24),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journey_event_inbox" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"event_id" text NOT NULL,
	"type" varchar(96) NOT NULL,
	"actor_id" text,
	"hop_count" integer DEFAULT 0 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journey_enrollments" ADD CONSTRAINT "journey_enrollments_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journey_enrollments" ADD CONSTRAINT "journey_enrollments_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journey_enrollments" ADD CONSTRAINT "journey_enrollments_contact_id_crm_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."crm_contacts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journey_enrollments" ADD CONSTRAINT "journey_enrollments_end_user_id_end_users_id_fk" FOREIGN KEY ("end_user_id") REFERENCES "public"."end_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journey_step_runs" ADD CONSTRAINT "journey_step_runs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journey_step_runs" ADD CONSTRAINT "journey_step_runs_enrollment_id_journey_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."journey_enrollments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journey_waits" ADD CONSTRAINT "journey_waits_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journey_waits" ADD CONSTRAINT "journey_waits_enrollment_id_journey_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."journey_enrollments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journey_waits" ADD CONSTRAINT "journey_waits_step_run_id_journey_step_runs_id_fk" FOREIGN KEY ("step_run_id") REFERENCES "public"."journey_step_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journey_event_inbox" ADD CONSTRAINT "journey_event_inbox_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "journey_enrollments_open_subject_uq" ON "journey_enrollments" USING btree ("journey_id","subject_key") WHERE state IN ('active', 'waiting');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journey_enrollments_claim_idx" ON "journey_enrollments" USING btree ("next_run_at") WHERE state = 'active';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journey_enrollments_journey_idx" ON "journey_enrollments" USING btree ("journey_id","state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journey_enrollments_contact_idx" ON "journey_enrollments" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journey_enrollments_end_user_idx" ON "journey_enrollments" USING btree ("end_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "journey_step_runs_visit_uq" ON "journey_step_runs" USING btree ("enrollment_id","node_id","visit");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journey_step_runs_enrollment_idx" ON "journey_step_runs" USING btree ("enrollment_id","started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journey_waits_wake_idx" ON "journey_waits" USING btree ("wake_at") WHERE resolved_at IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journey_waits_timeout_idx" ON "journey_waits" USING btree ("timeout_at") WHERE resolved_at IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journey_waits_event_idx" ON "journey_waits" USING btree ("org_id","event_key") WHERE resolved_at IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journey_waits_enrollment_idx" ON "journey_waits" USING btree ("enrollment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journey_event_inbox_pending_idx" ON "journey_event_inbox" USING btree ("created_at") WHERE processed_at IS NULL;
