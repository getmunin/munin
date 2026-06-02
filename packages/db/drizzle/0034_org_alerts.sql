-- system_alerts module: org-scoped operational alerts table.
-- Replaces ad-hoc "last error" tracking previously held on agent_health and
-- conv_inbound_state. Per-row attempt history on conv_message_deliveries and
-- curator_jobs is left untouched (different concern).

CREATE TABLE IF NOT EXISTS "org_alerts" (
    "id" text PRIMARY KEY NOT NULL,
    "org_id" text NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
    "source" varchar(32) NOT NULL,
    "subject_id" text,
    "severity" varchar(16) NOT NULL,
    "title" text NOT NULL,
    "detail" text,
    "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "cta_href" text,
    "cta_label_key" text,
    "opened_at" timestamptz NOT NULL DEFAULT now(),
    "last_seen_at" timestamptz NOT NULL DEFAULT now(),
    "occurrence_count" integer NOT NULL DEFAULT 1,
    "acknowledged_at" timestamptz,
    "acknowledged_by" text,
    "resolved_at" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "org_alerts_severity_chk" CHECK ("severity" IN ('warning', 'error')),
    CONSTRAINT "org_alerts_source_chk" CHECK ("source" IN (
        'llm_provider',
        'channel_inbound',
        'channel_outbound',
        'curator',
        'delivery',
        'quota'
    ))
);

CREATE INDEX IF NOT EXISTS "org_alerts_org_resolved_idx"
    ON "org_alerts" ("org_id", "resolved_at");

CREATE INDEX IF NOT EXISTS "org_alerts_org_opened_idx"
    ON "org_alerts" ("org_id", "opened_at");

-- One open alert per (org, source, subject). NULL subject coalesces to empty
-- string so "org-wide" alerts (no subject) still dedupe.
CREATE UNIQUE INDEX IF NOT EXISTS "org_alerts_open_uniq"
    ON "org_alerts" ("org_id", "source", (COALESCE("subject_id", '')))
    WHERE "resolved_at" IS NULL;

-- Drop replaced column from conv_inbound_state. The field now lives as alert
-- rows; cursor + last_polled_at stay (adapter progress, unrelated to alerts).
-- agent_health column drops live in agent-host's AGENT_HEALTH_*_DDL because
-- the table itself is created there, AFTER drizzle migrations run.
-- Per-row attempt state on conv_message_deliveries / curator_jobs is
-- intentionally not touched.
ALTER TABLE "conv_inbound_state" DROP COLUMN IF EXISTS "last_error";

-- RLS policy for org_alerts lives in src/sql/rls.sql (applied after the
-- app_bypass_rls() / app_org_id() helpers are defined).
