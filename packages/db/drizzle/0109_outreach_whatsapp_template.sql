-- WhatsApp outreach sends an approved message template, not free text: a
-- first touch outside the 24-hour customer-service window may only be a
-- template. The proposal keeps the template selection (name, language,
-- placeholder values) next to the rendered draft_body the operator reviews,
-- so delivery sends exactly what was approved. NULL on every non-WhatsApp
-- proposal, so no backfill.
ALTER TABLE "outreach_proposals" ADD COLUMN IF NOT EXISTS "whatsapp_template" jsonb;
