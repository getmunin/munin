-- The org's send rules can hold one broadcast recipient back (quiet hours in
-- their time zone, a conversation with the team) while the rest are sent.
ALTER TABLE "outreach_broadcast_recipients" ADD COLUMN IF NOT EXISTS "not_before" timestamp with time zone;
