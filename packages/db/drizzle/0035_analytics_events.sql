-- Analytics: append-only event tables for delivered page views and search
-- invocations. Polymorphic via (subject_type, subject_id) so CMS entries,
-- landing pages, dashboard routes, etc. all share the same ingest path.
-- Bot traffic is filtered upstream; IPs are intentionally not stored.

CREATE TABLE IF NOT EXISTS "analytics_view_events" (
    "id" text PRIMARY KEY NOT NULL,
    "org_id" text NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
    "subject_type" varchar(32) NOT NULL,
    "subject_id" text NOT NULL,
    "path" varchar(512),
    "locale" varchar(16),
    "referrer" varchar(512),
    "utm_source" varchar(128),
    "utm_medium" varchar(128),
    "utm_campaign" varchar(128),
    "visitor_id" varchar(64),
    "user_agent_class" varchar(16),
    "dwell_ms" integer,
    "read_depth" integer,
    "source" varchar(8) NOT NULL,
    "metadata" jsonb,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "analytics_view_events_source_chk" CHECK ("source" IN ('pixel', 'beacon')),
    CONSTRAINT "analytics_view_events_read_depth_chk"
        CHECK ("read_depth" IS NULL OR ("read_depth" >= 0 AND "read_depth" <= 100))
);

CREATE INDEX IF NOT EXISTS "analytics_view_events_org_idx"
    ON "analytics_view_events" ("org_id", "created_at");

CREATE INDEX IF NOT EXISTS "analytics_view_events_subject_idx"
    ON "analytics_view_events" ("org_id", "subject_type", "subject_id", "created_at");

CREATE INDEX IF NOT EXISTS "analytics_view_events_type_idx"
    ON "analytics_view_events" ("org_id", "subject_type", "created_at");

CREATE TABLE IF NOT EXISTS "analytics_search_events" (
    "id" text PRIMARY KEY NOT NULL,
    "org_id" text NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
    "subject_type" varchar(32) NOT NULL,
    "query" varchar(256) NOT NULL,
    "locale" varchar(16),
    "result_count" integer NOT NULL,
    "visitor_id" varchar(64),
    "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "analytics_search_events_zero_idx"
    ON "analytics_search_events" ("org_id", "subject_type", "result_count", "created_at");

CREATE INDEX IF NOT EXISTS "analytics_search_events_org_idx"
    ON "analytics_search_events" ("org_id", "created_at");

-- RLS policies live in src/sql/analytics.sql so they run AFTER the
-- app_bypass_rls() / app_org_id() helpers are defined.
