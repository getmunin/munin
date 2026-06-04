CREATE TABLE IF NOT EXISTS "analytics_trackers" (
    "id" text PRIMARY KEY NOT NULL,
    "org_id" text NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
    "name" text NOT NULL,
    "allowed_origins" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "analytics_trackers_org_idx"
    ON "analytics_trackers" ("org_id");

ALTER TABLE "api_keys"
    ADD COLUMN IF NOT EXISTS "tracker_id" text
        REFERENCES "analytics_trackers"("id") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "api_keys_tracker_idx"
    ON "api_keys" ("tracker_id");

ALTER TABLE "analytics_view_events"
    DROP CONSTRAINT IF EXISTS "analytics_view_events_source_chk";

ALTER TABLE "analytics_view_events"
    ADD CONSTRAINT "analytics_view_events_source_chk"
    CHECK ("source" IN ('pixel', 'beacon', 'tracker'));

ALTER TABLE "api_keys"
    DROP CONSTRAINT IF EXISTS "api_keys_track_requires_tracker_chk";

ALTER TABLE "api_keys"
    ADD CONSTRAINT "api_keys_track_requires_tracker_chk"
    CHECK ("type" <> 'track' OR "tracker_id" IS NOT NULL);

ALTER TABLE "api_keys"
    DROP CONSTRAINT IF EXISTS "api_keys_widget_requires_channel_chk";

ALTER TABLE "api_keys"
    ADD CONSTRAINT "api_keys_widget_requires_channel_chk"
    CHECK ("type" <> 'widget' OR "channel_id" IS NOT NULL) NOT VALID;
