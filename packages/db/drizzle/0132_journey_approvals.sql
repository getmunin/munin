-- Approval steps: a run waits here until a signed-in person approves or rejects
-- it in the dashboard. One row per step run. Tenant isolation lives in journeys.sql.
CREATE TABLE IF NOT EXISTS "journey_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"journey_id" text NOT NULL,
	"enrollment_id" text NOT NULL,
	"step_run_id" text NOT NULL,
	"node_id" varchar(48) NOT NULL,
	"contact_id" text,
	"title" text NOT NULL,
	"instructions" text,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_by_actor_id" text,
	"decided_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journey_approvals" ADD CONSTRAINT "journey_approvals_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journey_approvals" ADD CONSTRAINT "journey_approvals_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journey_approvals" ADD CONSTRAINT "journey_approvals_enrollment_id_journey_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."journey_enrollments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "journey_approvals_step_run_uq" ON "journey_approvals" USING btree ("step_run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journey_approvals_pending_idx" ON "journey_approvals" USING btree ("org_id","status");
