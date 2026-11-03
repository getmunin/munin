-- Server-side product events posted by the org's backend to POST /v1/events.
-- Idempotent on (org_id, external_event_id); each accepted row is emitted as
-- analytics.product_event.recorded so segments and journeys can react.
-- Tenant isolation policies live in analytics.sql.
CREATE TABLE IF NOT EXISTS "analytics_product_events" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"external_event_id" varchar(128) NOT NULL,
	"name" varchar(64) NOT NULL,
	"end_user_id" text,
	"contact_id" text,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "analytics_product_events" ADD CONSTRAINT "analytics_product_events_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "analytics_product_events" ADD CONSTRAINT "analytics_product_events_end_user_id_end_users_id_fk" FOREIGN KEY ("end_user_id") REFERENCES "public"."end_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "analytics_product_events" ADD CONSTRAINT "analytics_product_events_contact_id_crm_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."crm_contacts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "analytics_product_events_external_uq" ON "analytics_product_events" USING btree ("org_id","external_event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_product_events_name_idx" ON "analytics_product_events" USING btree ("org_id","name","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_product_events_contact_idx" ON "analytics_product_events" USING btree ("contact_id","name","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_product_events_end_user_idx" ON "analytics_product_events" USING btree ("end_user_id","name","occurred_at");
