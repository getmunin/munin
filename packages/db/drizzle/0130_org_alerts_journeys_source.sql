-- The journey monitor raises alerts when it pauses a journey or step on a
-- guardrail breach. `source` is guarded by a CHECK constraint drizzle-kit cannot
-- see in schema.ts, so this drops and recreates it restating every allowed value.
ALTER TABLE "org_alerts" DROP CONSTRAINT IF EXISTS "org_alerts_source_chk";--> statement-breakpoint

ALTER TABLE "org_alerts" ADD CONSTRAINT "org_alerts_source_chk" CHECK ("source" IN (
    'llm_provider',
    'channel_inbound',
    'channel_outbound',
    'curator',
    'delivery',
    'quota',
    'social',
    'data_protection',
    'journeys'
));
