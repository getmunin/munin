-- Handle-based identity: a username is the whole address on Reddit (and on
-- Bluesky / Mastodon / Discord later), so it sits beside email and phone
-- rather than in metadata jsonb, and gets the same org-scoped index they have.
ALTER TABLE "conv_contacts" ADD COLUMN IF NOT EXISTS "handle" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conv_contacts_handle_idx"
  ON "conv_contacts" ("org_id", "handle");
--> statement-breakpoint
ALTER TABLE "crm_contacts" ADD COLUMN IF NOT EXISTS "handle" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crm_contacts_handle_idx"
  ON "crm_contacts" ("org_id", "handle");
--> statement-breakpoint

-- Provider-thread identity for conversations. Poll-mode adapters that thread on
-- something other than "who wrote it" (a Reddit post, a forum topic) stamp the
-- key here and the shared ingest path resolves on it before falling back to
-- contact-based threading. Same shape as the existing vapi/threll call indexes.
CREATE UNIQUE INDEX IF NOT EXISTS "conv_conversations_conversation_key_uq"
  ON "conv_conversations" ("org_id", "channel_id", (("metadata" ->> 'conversationKey')))
  WHERE ("metadata" ->> 'conversationKey') IS NOT NULL;
--> statement-breakpoint

-- Campaign discriminator. `segment` is every campaign that exists today, so
-- ADD COLUMN ... NOT NULL DEFAULT backfills them as DDL — no data pass, and
-- therefore no FORCE-RLS bypass needed here.
ALTER TABLE "outreach_campaigns"
  ADD COLUMN IF NOT EXISTS "kind" varchar(16) NOT NULL DEFAULT 'segment';
--> statement-breakpoint

-- An engagement campaign targets public threads, not a CRM segment.
ALTER TABLE "outreach_campaigns" ALTER COLUMN "segment_id" DROP NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'outreach_campaigns_segment_required_ck'
  ) THEN
    ALTER TABLE "outreach_campaigns"
      ADD CONSTRAINT "outreach_campaigns_segment_required_ck"
      CHECK ("kind" <> 'segment' OR "segment_id" IS NOT NULL);
  END IF;
END $$;
--> statement-breakpoint

-- Thread-target proposals have no data subject: the target is a public post.
ALTER TABLE "outreach_proposals" ALTER COLUMN "contact_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "outreach_proposals" ADD COLUMN IF NOT EXISTS "target" jsonb;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'outreach_proposals_one_target_ck'
  ) THEN
    ALTER TABLE "outreach_proposals"
      ADD CONSTRAINT "outreach_proposals_one_target_ck"
      CHECK (("contact_id" IS NOT NULL) <> (("target" ->> 'threadId') IS NOT NULL));
  END IF;
END $$;
--> statement-breakpoint

-- "Never comment twice in one thread", enforced below the service.
--
-- `outreach_proposals_open_pair_uq` stops deduplicating once contact_id is
-- NULL (Postgres treats NULLs as distinct), so thread proposals need their own.
--
-- One index spanning pending+approved+sent, not one per status group: with a
-- pending-only and an approved/sent-only index, a thread we have ALREADY
-- commented in still accepts a new pending draft — the collision only fires
-- when a human approves it, i.e. as a unique violation mid-request, which
-- poisons the transaction and surfaces as a bare 500. Blocking it at propose
-- time is both the correct moment and the reportable one.
--
-- Scoped to kind='thread_comment' so it constrains only the top-level comment.
-- Replies to whoever answered us are a different kind and are unconstrained —
-- one comment per thread is the cold-open rule, not a gag on the conversation.
-- dismissed / withdrawn / failed drop out of the index, so a rejected draft
-- never permanently burns the thread.
CREATE UNIQUE INDEX IF NOT EXISTS "outreach_proposals_thread_comment_uq"
  ON "outreach_proposals" ("campaign_id", (("target" ->> 'threadId')))
  WHERE "kind" = 'thread_comment'
    AND "status" IN ('pending', 'approved', 'sent')
    AND ("target" ->> 'threadId') IS NOT NULL;
--> statement-breakpoint

-- The contactless analogue of `outreach_proposals_open_pair_uq`: at most one
-- in-flight reply draft per contactless conversation. Like that index, the
-- predicate spans pending AND approved -- an approved reply is a send authorized
-- for later, so it has to block a fresh duplicate draft just as a pending one
-- does. Decided rows (sent / failed / dismissed / withdrawn) fall outside it so
-- the conversation can be replied to again.
CREATE UNIQUE INDEX IF NOT EXISTS "outreach_proposals_open_conv_uq"
  ON "outreach_proposals" ("campaign_id", "conversation_id", "kind")
  WHERE "status" IN ('pending', 'approved')
    AND "contact_id" IS NULL
    AND "conversation_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_proposals_subreddit_idx"
  ON "outreach_proposals" ("campaign_id", (("target" ->> 'subreddit')), "sent_at")
  WHERE ("target" ->> 'subreddit') IS NOT NULL;
