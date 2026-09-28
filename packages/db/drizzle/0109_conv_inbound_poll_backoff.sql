-- Per-channel failure bookkeeping for the inbound poll worker.
--
-- A mailbox that is briefly unreachable used to open, resolve and re-open a
-- system alert on every flap, and five failed polls in a row switched the
-- channel off even when the server came back a minute later. The worker now
-- backs off a failing channel (next_poll_at), only alerts on a transient
-- failure once it has lasted a while (failing_since), and counts consecutive
-- failures itself rather than borrowing the alert's occurrence count.
-- last_failure_at lets an operator's edit or reactivation of the channel
-- (conv_channels.updated_at moving past it) clear the backoff.
--
-- conv_inbound_state keeps its existing tenant_isolation policy; the new
-- columns need no policy of their own.
ALTER TABLE "conv_inbound_state" ADD COLUMN IF NOT EXISTS "consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "conv_inbound_state" ADD COLUMN IF NOT EXISTS "failing_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conv_inbound_state" ADD COLUMN IF NOT EXISTS "last_failure_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conv_inbound_state" ADD COLUMN IF NOT EXISTS "next_poll_at" timestamp with time zone;
