-- A company's legal identity: the country of the business registry that
-- issued it and its registry number there (orgnr in Norway, organisations-
-- nummer in Sweden, CVR in Denmark, a Companies House number in the UK).
-- The application normalizes the number before writing, so the pair is a
-- stable dedupe key; one org can hold each registration at most once.
ALTER TABLE "crm_companies" ADD COLUMN IF NOT EXISTS "registration_country" text;--> statement-breakpoint
ALTER TABLE "crm_companies" ADD COLUMN IF NOT EXISTS "registration_number" text;--> statement-breakpoint
ALTER TABLE "crm_companies" DROP CONSTRAINT IF EXISTS "crm_companies_registration_pair_chk";--> statement-breakpoint
ALTER TABLE "crm_companies" ADD CONSTRAINT "crm_companies_registration_pair_chk"
    CHECK (("registration_country" IS NULL) = ("registration_number" IS NULL));--> statement-breakpoint
ALTER TABLE "crm_companies" DROP CONSTRAINT IF EXISTS "crm_companies_registration_country_chk";--> statement-breakpoint
ALTER TABLE "crm_companies" ADD CONSTRAINT "crm_companies_registration_country_chk"
    CHECK ("registration_country" IS NULL OR "registration_country" ~ '^[A-Z]{2}$');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "crm_companies_org_registration_uq"
    ON "crm_companies" ("org_id", "registration_country", "registration_number")
    WHERE "registration_number" IS NOT NULL;--> statement-breakpoint
-- Listing one seller's companies filters on the owner.
CREATE INDEX IF NOT EXISTS "crm_companies_org_owner_idx"
    ON "crm_companies" ("org_id", "owner_user_id");
