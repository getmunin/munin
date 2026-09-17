-- A national identity number arriving in an inbox is an org-level data-protection
-- concern, not a channel fault: it needs its own alert source so the dashboard can
-- group it apart from inbound/outbound delivery problems.
ALTER TABLE "org_alerts" DROP CONSTRAINT IF EXISTS "org_alerts_source_chk";

ALTER TABLE "org_alerts" ADD CONSTRAINT "org_alerts_source_chk" CHECK ("source" IN (
    'llm_provider',
    'channel_inbound',
    'channel_outbound',
    'curator',
    'delivery',
    'quota',
    'data_protection'
));
