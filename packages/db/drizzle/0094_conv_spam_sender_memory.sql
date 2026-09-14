-- Remember a junk sender, not just a junk thread.
--
-- `mark_spam` (the runtime audit action) and an operator's own "mark spam" both
-- wrote conv_conversations.status and nothing else, so the judgment died with the
-- thread. A sender who opens eight threads in a day was re-judged eight times,
-- each at the cost of a full agent pass — KB search, draft, audit — and each of
-- those threads then sat in the review queue waiting for a human.
--
-- Two columns carry the fix:
--
--   conv_contacts.spam_marked_at / spam_marked_by
--     Stamped when a conversation belonging to the contact is marked spam, and
--     cleared the moment a human replies to them or reopens one of their threads.
--     Inbound from a stamped contact is settled at ingest, before any model runs.
--
--   conv_conversations.suppressed_reason
--     Why a conversation was settled without an agent pass — 'auto_reply',
--     'bounce', 'no_reply_address' or 'spam_sender'. The same fact already lives
--     on the first inbound message's metadata, but reaching into JSONB is not a
--     filter the inbox can index, and an operator auditing what got suppressed
--     needs exactly this column.

ALTER TABLE "conv_contacts" ADD COLUMN IF NOT EXISTS "spam_marked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conv_contacts" ADD COLUMN IF NOT EXISTS "spam_marked_by" text;--> statement-breakpoint
ALTER TABLE "conv_conversations" ADD COLUMN IF NOT EXISTS "suppressed_reason" varchar(32);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conv_contacts_spam_idx" ON "conv_contacts" USING btree ("org_id","spam_marked_at") WHERE spam_marked_at IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conv_conversations_suppressed_idx" ON "conv_conversations" USING btree ("org_id","suppressed_reason") WHERE suppressed_reason IS NOT NULL;--> statement-breakpoint

-- Backfill. Both statements are predicate-guarded, so a corrected timestamp can
-- re-run this migration harmlessly. conv_contacts and conv_conversations are
-- FORCE RLS and the migration connection is not necessarily a superuser, so the
-- bypass GUC has to be set for the reads below to see anything at all.
DO $$
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);

  -- Every conversation already settled by the ingest-time suppression path
  -- recorded its reason on the first inbound message. Lift it onto the
  -- conversation so the new column describes history as well as new traffic.
  UPDATE conv_conversations c
  SET suppressed_reason = m.reason
  FROM (
    SELECT DISTINCT ON (conversation_id)
      conversation_id,
      metadata->>'suppressed' AS reason
    FROM conv_messages
    WHERE internal = FALSE
      AND metadata->>'suppressed' IS NOT NULL
    ORDER BY conversation_id, created_at ASC
  ) m
  WHERE m.conversation_id = c.id
    AND c.suppressed_reason IS NULL;

  -- A contact who already owns a spam-marked conversation is a known junk
  -- sender; stamp them so their next thread never reaches the runner. Attributed
  -- to 'backfill' rather than a user id — the original decision was not recorded.
  UPDATE conv_contacts ct
  SET spam_marked_at = now(),
      spam_marked_by = 'backfill',
      updated_at = now()
  WHERE ct.spam_marked_at IS NULL
    AND EXISTS (
      SELECT 1 FROM conv_conversations c
      WHERE c.contact_id = ct.id
        AND c.status = 'spam'
    );

  -- The threads that motivated all this are still sitting open: one sender who
  -- was judged junk once had already opened seven more conversations, each with
  -- its own agent draft waiting in the review queue. Settle the ones nobody has
  -- answered — a thread a teammate has replied to is theirs, whatever the
  -- sender's reputation, so an outbound human message keeps it open.
  UPDATE conv_conversations c
  SET status = 'spam',
      suppressed_reason = 'spam_sender',
      needs_human_attention = FALSE,
      needs_human_attention_at = NULL,
      runner_holder = NULL,
      runner_lease_expires_at = NULL,
      updated_at = now()
  FROM conv_contacts ct
  WHERE ct.id = c.contact_id
    AND ct.spam_marked_at IS NOT NULL
    AND c.status IN ('open', 'snoozed')
    AND NOT EXISTS (
      SELECT 1 FROM conv_messages m
      WHERE m.conversation_id = c.id
        AND m.internal = FALSE
        AND m.author_type = 'user'
    );
END $$;
