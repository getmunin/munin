-- Inbox rows that fail are retried with backoff instead of being marked
-- processed on the first error, which silently dropped the event for every journey.
ALTER TABLE "journey_event_inbox" ADD COLUMN IF NOT EXISTS "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "journey_event_inbox" ADD COLUMN IF NOT EXISTS "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "journey_event_inbox" ADD COLUMN IF NOT EXISTS "last_error" text;
