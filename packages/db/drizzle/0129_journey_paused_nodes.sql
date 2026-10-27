-- Per-node kill switch: a paused node holds every run that reaches it until a
-- person or agent resumes it. The journey monitor sets it on a guardrail breach.
ALTER TABLE "journeys" ADD COLUMN IF NOT EXISTS "paused_nodes" jsonb DEFAULT '{}'::jsonb NOT NULL;
