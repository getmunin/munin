-- Records which Slack thread an approval card was posted into.
--
-- The CMS locale parent is created lazily: a translation group is a group of
-- one until its second locale exists, so the first locale's card is posted as
-- a standalone channel message and the parent appears underneath it. Slack
-- cannot move a message into a thread, so the bridge now deletes and reposts
-- such a card once the parent exists. Deciding what to repost needs a stored
-- fact rather than a guess: slack_thread_ts NULL means "this card is a
-- top-level channel message", and a non-NULL value is the parent it hangs
-- under.
ALTER TABLE "slack_notification_links" ADD COLUMN IF NOT EXISTS "slack_thread_ts" text;--> statement-breakpoint

-- Backfill: cards posted after their group's parent already existed went into
-- the thread, and must not be reposted. Their link row is created later than
-- the parent's, in the same channel -- cards created BEFORE their parent are
-- exactly the stranded ones, and stay NULL so the bridge rehomes them.
--
-- slack_notification_links and cms_entries are both FORCE RLS, so the bypass
-- GUC is required even for the table owner.
DO $$
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);

  UPDATE slack_notification_links AS card
  SET slack_thread_ts = parent.slack_ts
  FROM cms_entries AS entry,
       slack_notification_links AS parent
  WHERE card.subject_type = 'cms_draft_entry'
    AND card.slack_thread_ts IS NULL
    AND entry.id = card.subject_id
    AND parent.integration_id = card.integration_id
    AND parent.subject_type = 'cms_draft_group'
    AND parent.subject_id = entry.translation_group_id
    AND parent.slack_channel_id = card.slack_channel_id
    AND parent.created_at <= card.created_at;
END $$;
