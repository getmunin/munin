ALTER TABLE "curator_jobs"
  ADD COLUMN IF NOT EXISTS "last_error_code" varchar(64),
  ADD COLUMN IF NOT EXISTS "failed_step" varchar(64);

ALTER TABLE "curator_jobs"
  ALTER COLUMN "status" TYPE varchar(32);

CREATE INDEX IF NOT EXISTS "curator_jobs_failed_retryable_idx"
  ON "curator_jobs" ("org_id")
  WHERE "status" = 'failed_retryable';
