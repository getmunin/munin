ALTER TABLE "crm_contacts"
  ADD COLUMN IF NOT EXISTS "consent_lawful_basis" varchar(32),
  ADD COLUMN IF NOT EXISTS "consent_given_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "consent_source" text,
  ADD COLUMN IF NOT EXISTS "consent_evidence" jsonb;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "crm_segments" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "filter_definition" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_by_actor_type" varchar(16) NOT NULL,
  "created_by_actor_id" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "crm_segments_org_idx" ON "crm_segments" ("org_id");
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "crm_segments_org_name_uq" ON "crm_segments" ("org_id", "name");
