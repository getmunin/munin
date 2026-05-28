-- Feedback module: deployment-wide system_config + org-scoped outbox.
-- system_config is a small singleton store (e.g. instance_id, future flags);
-- feedback_outbox holds items pending org-admin approval before they are
-- forwarded to Munin's cloud roadmap. Module is gated by MUNIN_FEEDBACK_ENABLED.

CREATE TABLE IF NOT EXISTS "system_config" (
    "key" text PRIMARY KEY NOT NULL,
    "value" jsonb NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "feedback_outbox" (
    "id" text PRIMARY KEY NOT NULL,
    "org_id" text NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
    "submitted_by_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
    "title" text NOT NULL,
    "body" text NOT NULL,
    "app_scope" varchar(32),
    "include_org_name" boolean NOT NULL DEFAULT false,
    "include_user_name" boolean NOT NULL DEFAULT false,
    "approved_at" timestamptz,
    "sent_at" timestamptz,
    "forward_error" text,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "feedback_outbox_org_idx"
    ON "feedback_outbox" ("org_id", "created_at");

-- RLS policies for system_config + feedback_outbox live in
-- src/sql/rls.sql so they run AFTER the app_bypass_rls() / app_org_id()
-- helpers are defined; Drizzle migrations run before that file.
