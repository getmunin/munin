-- A draft version opened by the optimiser carries its rationale, hypothesis,
-- evidence and dry-run summary, so the person who publishes it sees why.
ALTER TABLE "journey_versions" ADD COLUMN IF NOT EXISTS "proposal" jsonb;
