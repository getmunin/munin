CREATE TABLE IF NOT EXISTS "curator_jobs" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
  "skill_uri" text NOT NULL,
  "user_prompt" text NOT NULL,
  "source_event_type" text,
  "source_event_payload" jsonb,
  "dedupe_key" text,
  "status" varchar(16) NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 5,
  "next_attempt_at" timestamp with time zone NOT NULL DEFAULT now(),
  "lease_expires_at" timestamp with time zone,
  "lease_holder" text,
  "last_error" text,
  "last_reply_text" text,
  "last_tool_calls" integer,
  "last_total_tokens" integer,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "done_at" timestamp with time zone
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "curator_jobs_org_status_idx"
  ON "curator_jobs" ("org_id", "status");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "curator_jobs_pending_idx"
  ON "curator_jobs" ("next_attempt_at");
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "curator_jobs_dedupe_uq"
  ON "curator_jobs" ("org_id", "dedupe_key")
  WHERE "dedupe_key" IS NOT NULL AND "status" = 'pending';
