-- analytics_view_events.country: optional ISO 3166-1 alpha-2 derived from
-- the client IP at ingest time via a local MaxMind-format GeoIP DB. Always
-- nullable — backend works without the DB configured (column stays NULL),
-- and bot/private/unknown IPs also resolve to NULL. No IP is persisted.

ALTER TABLE "analytics_view_events"
  ADD COLUMN IF NOT EXISTS "country" varchar(2);
