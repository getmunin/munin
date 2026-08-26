-- Per-campaign declaration of the fields a call-outcome extraction pass
-- writes into crm_contacts.custom_fields. Empty array = extraction off.
ALTER TABLE "outreach_campaigns" ADD COLUMN IF NOT EXISTS "extraction_schema" jsonb DEFAULT '[]'::jsonb NOT NULL;
