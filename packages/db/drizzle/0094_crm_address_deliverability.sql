CREATE TABLE IF NOT EXISTS "crm_address_deliverability" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"address" text NOT NULL,
	"state" varchar(16) DEFAULT 'valid' NOT NULL,
	"reason" varchar(32),
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"first_failure_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"state_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_actor_type" varchar(16),
	"updated_by_actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- ADD CONSTRAINT has no IF NOT EXISTS form, so the FK is guarded against
-- re-running on a database that already has the table.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_address_deliverability_org_id_orgs_id_fk') THEN
    ALTER TABLE "crm_address_deliverability" ADD CONSTRAINT "crm_address_deliverability_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "crm_address_deliverability_org_address_uq" ON "crm_address_deliverability" USING btree ("org_id","address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crm_address_deliverability_state_idx" ON "crm_address_deliverability" USING btree ("org_id","state");
