-- A chat widget opens its conversation as soon as the panel opens, and the
-- agent greets before the visitor has typed anything. Most visitors who never
-- reply used to leave behind an open conversation in the inbox, a Slack thread
-- and a "resolved" reply when auto-close got to it two days later.
--
-- `unengaged` marks a conversation the widget opened that no person has
-- written in yet. Inbox lists, queue counts and usage skip it, the Slack
-- bridge holds its deliveries until the flag clears, and a scheduled sweep
-- deletes it once it has been idle long enough. The first visitor message,
-- voice call or teammate message clears it.
ALTER TABLE "conv_conversations" ADD COLUMN IF NOT EXISTS "unengaged" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conv_conversations_unengaged_idx" ON "conv_conversations" USING btree ("org_id","last_message_at") WHERE unengaged = true;--> statement-breakpoint

-- Backfill: widget-opened conversations carry metadata.pendingGreeting from
-- creation. Those without a single visitor or teammate message are exactly
-- the ones the flag describes, whatever status auto-close left them in.
--
-- conv_conversations and conv_messages are FORCE RLS, so the bypass GUC is
-- required even for the table owner.
DO $$
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);

  UPDATE conv_conversations AS c
  SET unengaged = true
  WHERE c.unengaged = false
    AND c.metadata->>'pendingGreeting' = 'true'
    AND NOT EXISTS (
      SELECT 1 FROM conv_messages m
      WHERE m.conversation_id = c.id
        AND m.author_type IN ('end_user', 'user')
    );
END $$;
