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

ALTER TABLE "assistants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assistants" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "assistants";
CREATE POLICY "tenant_isolation" ON "assistants"
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

-- Backfill: one assistant row per existing org (name/greeting null = use defaults).
INSERT INTO "assistants" ("id", "org_id")
SELECT 'ast_' || substr(md5(random()::text || o.id), 1, 16), o.id
FROM "orgs" o
WHERE NOT EXISTS (SELECT 1 FROM "assistants" a WHERE a.org_id = o.id);
