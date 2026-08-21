-- Slack threads are append-only: whatever order the bridge worker drains
-- slack_deliveries in becomes the order a reader sees in the thread. The drain
-- ordered by created_at, i.e. by webhook arrival time, which is not turn order
-- for voice transcripts — a caller turn finalizes through ASR after the agent
-- turn that answers it, so agent replies were posted ahead of the questions
-- they answered.
--
-- order_at / order_seq carry the mirrored message's own position instead:
-- order_at is conv_messages.created_at, order_seq is its metadata
-- voiceTurnIndex (the authoritative voice sequence, used as the tiebreak when
-- two turns share a timestamp). Rows that mirror no message — status changes,
-- assignments, handovers — keep created_at and -1 so they stay where they
-- happened in real time rather than being hoisted to either end.
--
-- Existing rows are backfilled from created_at, which reproduces exactly the
-- ordering they have today. slack_deliveries is FORCE ROW LEVEL SECURITY, so
-- the backfill runs with the bypass GUC set; without it the UPDATE matches
-- nothing on a real deploy while looking green in CI, where migrations connect
-- as a superuser. Idempotent throughout: re-running is a no-op.

DROP INDEX IF EXISTS "slack_deliveries_conv_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "slack_deliveries_subject_idx";--> statement-breakpoint
ALTER TABLE "slack_deliveries" ADD COLUMN IF NOT EXISTS "order_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "slack_deliveries" ADD COLUMN IF NOT EXISTS "order_seq" integer DEFAULT -1 NOT NULL;--> statement-breakpoint
DO $$
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);

  UPDATE "slack_deliveries"
  SET "order_at" = "created_at"
  WHERE "order_at" <> "created_at";
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "slack_deliveries_conv_idx" ON "slack_deliveries" USING btree ("conversation_id","order_at","order_seq","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "slack_deliveries_subject_idx" ON "slack_deliveries" USING btree ("subject_key","order_at","order_seq","created_at");
