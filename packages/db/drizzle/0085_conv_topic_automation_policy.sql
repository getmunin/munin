-- Topic-level automation policy.
--
-- conv_topics.agent_mode is NULL for every existing topic, which means "no
-- policy" — the conversation's own mode stands, so this migration cannot change
-- how any conversation behaves on deploy.
--
-- conv_conversations.agent_mode_source records whether a conversation's mode was
-- inherited from its channel default or set deliberately by an operator. Existing
-- rows are backfilled to 'default': none of them were set through the explicit
-- path, because that path is introduced by this change. An operator who turns the
-- agent off for one conversation must not have it turned back on by a later topic
-- promotion, and this column is what protects that.
ALTER TABLE "conv_conversations" ADD COLUMN IF NOT EXISTS "agent_mode_source" varchar(16) DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "conv_topics" ADD COLUMN IF NOT EXISTS "agent_mode" varchar(16);--> statement-breakpoint
ALTER TABLE "conv_topics" ADD COLUMN IF NOT EXISTS "auto_promoted_at" timestamp with time zone;
