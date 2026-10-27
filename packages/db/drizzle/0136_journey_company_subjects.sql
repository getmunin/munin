-- Company journeys run once per company instead of once per person. The run
-- keeps its company here; contact_id and end_user_id stay empty for it.
ALTER TABLE "journey_enrollments" ADD COLUMN IF NOT EXISTS "company_id" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "journey_enrollments" ADD CONSTRAINT "journey_enrollments_company_id_crm_companies_id_fk"
    FOREIGN KEY ("company_id") REFERENCES "public"."crm_companies"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journey_enrollments_company_idx" ON "journey_enrollments" USING btree ("company_id");
