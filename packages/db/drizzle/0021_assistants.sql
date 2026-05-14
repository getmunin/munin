CREATE TABLE IF NOT EXISTS "assistants" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
  "name" text,
  "greeting" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "assistants_org_uq"
  ON "assistants" ("org_id");

-- RLS enable + tenant_isolation policy are applied by src/sql/rls.sql,
-- which runs AFTER drizzle migrations and is the only place the
-- app_bypass_rls() / app_org_id() helpers are defined. Don't inline the
-- policy here — the helpers don't exist yet at migration time.

-- Backfill: one assistant row per existing org (name/greeting null = use defaults).
INSERT INTO "assistants" ("id", "org_id")
SELECT 'ast_' || substr(md5(random()::text || o.id), 1, 16), o.id
FROM "orgs" o
WHERE NOT EXISTS (SELECT 1 FROM "assistants" a WHERE a.org_id = o.id);
