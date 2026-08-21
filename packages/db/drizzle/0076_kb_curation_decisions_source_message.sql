-- Per-message curation decisions.
--
-- The "already decided" check used to key on source_conversation_id alone, which
-- closed a conversation to curation forever after the first decision. A single
-- conversation can legitimately surface several corrections across turns, so the
-- key becomes (conversation, message).
--
-- Rows written before this migration have a null source_message_id and keep the
-- old whole-conversation lock, so no backfill is needed and no past decision is
-- silently reopened.
ALTER TABLE "kb_curation_decisions" ADD COLUMN IF NOT EXISTS "source_message_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_curation_decisions_org_source_msg_idx" ON "kb_curation_decisions" USING btree ("org_id","source_message_id");
