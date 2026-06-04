-- Analytics: widen the source check constraint to permit `tracker` rows
-- (drop-in browser script using a public mn_track_* API key) alongside
-- the existing `pixel`/`beacon` HMAC-token sources.

ALTER TABLE "analytics_view_events"
    DROP CONSTRAINT IF EXISTS "analytics_view_events_source_chk";

ALTER TABLE "analytics_view_events"
    ADD CONSTRAINT "analytics_view_events_source_chk"
    CHECK ("source" IN ('pixel', 'beacon', 'tracker'));
