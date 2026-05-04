CREATE TABLE IF NOT EXISTS "crm_merge_proposals" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
  "contact_a_id" text NOT NULL REFERENCES "crm_contacts"("id") ON DELETE CASCADE,
  "contact_b_id" text NOT NULL REFERENCES "crm_contacts"("id") ON DELETE CASCADE,
  "confidence" varchar(8) NOT NULL,
  "evidence" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "recommended_keeper_id" text NOT NULL,
  "recommended_patch" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" varchar(16) NOT NULL DEFAULT 'pending',
  "dismiss_reason" text,
  "proposed_by_actor_type" varchar(16) NOT NULL,
  "proposed_by_actor_id" text NOT NULL,
  "decided_by_actor_type" varchar(16),
  "decided_by_actor_id" text,
  "decided_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "crm_merge_proposals_org_status_idx"
  ON "crm_merge_proposals" ("org_id", "status");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "crm_merge_proposals_contact_a_idx"
  ON "crm_merge_proposals" ("contact_a_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "crm_merge_proposals_contact_b_idx"
  ON "crm_merge_proposals" ("contact_b_id");
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "crm_merge_proposals_pending_pair_uq"
  ON "crm_merge_proposals" ("org_id", "contact_a_id", "contact_b_id")
  WHERE "status" = 'pending';
