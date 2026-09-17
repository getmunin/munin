-- A national identity number arriving in an inbox is an org-level data-protection
-- concern, not a channel fault: it needs its own alert source so the dashboard can
-- group it apart from inbound/outbound delivery problems.
--
-- `source` is guarded by a CHECK constraint drizzle-kit cannot see in schema.ts, so
-- this is a drop-and-recreate: the list below must restate every value already
-- allowed, not just the new one. 'social' arrived in 0098 while this migration sat
-- unmerged — dropping it here would revoke it.
--
-- Written idempotently so a corrected journal timestamp can re-run it harmlessly.
ALTER TABLE "org_alerts" DROP CONSTRAINT IF EXISTS "org_alerts_source_chk";--> statement-breakpoint

ALTER TABLE "org_alerts" ADD CONSTRAINT "org_alerts_source_chk" CHECK ("source" IN (
    'llm_provider',
    'channel_inbound',
    'channel_outbound',
    'curator',
    'delivery',
    'quota',
    'social',
    'data_protection'
));
