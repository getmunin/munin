-- Alerts gain a user dimension. NULL user_id means org-scoped, which is what
-- every pre-existing row is and what every current writer still produces —
-- so this column is additive and no backfill is required.
--
-- Written idempotently: a corrected journal timestamp must be able to re-run
-- this migration harmlessly on a database that already has it.

ALTER TABLE "org_alerts" ADD COLUMN IF NOT EXISTS "user_id" text;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'org_alerts_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "org_alerts"
      ADD CONSTRAINT "org_alerts_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "org_alerts_user_open_idx"
  ON "org_alerts" USING btree ("org_id","user_id","resolved_at");
--> statement-breakpoint

-- `source` is guarded by a CHECK constraint declared in 0034, not by anything
-- drizzle-kit can see in schema.ts — so adding a value to the ALERT_SOURCES
-- union in TypeScript is not enough on its own. Drop-and-recreate keeps this
-- re-runnable.
ALTER TABLE "org_alerts" DROP CONSTRAINT IF EXISTS "org_alerts_source_chk";--> statement-breakpoint
ALTER TABLE "org_alerts" ADD CONSTRAINT "org_alerts_source_chk" CHECK ("source" IN (
    'llm_provider',
    'channel_inbound',
    'channel_outbound',
    'curator',
    'delivery',
    'quota',
    'social'
));
--> statement-breakpoint

-- The partial unique index from 0034 is what actually enforces "one open alert
-- per key" — AlertsService's find-then-insert is racy without it. Its key must
-- gain user_id, or two members whose LinkedIn tokens expire under the same
-- (source, subject) collide on insert and one member's alert is lost.
-- COALESCE keeps NULL (org-scoped) a comparable value, matching the existing
-- treatment of subject_id.
DROP INDEX IF EXISTS "org_alerts_open_uniq";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "org_alerts_open_uniq"
    ON "org_alerts" ("org_id", "source", (COALESCE("subject_id", '')), (COALESCE("user_id", '')))
    WHERE "resolved_at" IS NULL;
