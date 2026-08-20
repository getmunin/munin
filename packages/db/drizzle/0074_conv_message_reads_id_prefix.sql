-- conv_message_reads and cms_references both minted ids with the `cmr_` prefix.
-- cms_* consistently uses cm* (cmc, cme, cma, cml, cmar), so cms_references keeps
-- `cmr_` and conv_message_reads moves to `cvr_`, matching `cvm_` for conv_messages.
--
-- Safe to rewrite in place: conv_message_reads is a leaf — no other table has a
-- foreign key to its id — and only the prefix changes, so the random suffix keeps
-- each id unique. The (message_id, end_user_id) unique index is untouched.
-- Idempotent: re-running matches nothing.
--
-- conv_message_reads is FORCE ROW LEVEL SECURITY, which applies to the table owner
-- too, so the rewrite runs inside a bypass_rls block. Without it the UPDATE matches
-- no rows on an existing deploy while looking perfectly green in CI, where
-- migrations connect as a superuser and RLS is bypassed anyway.
DO $$
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);

  UPDATE "conv_message_reads"
  SET "id" = 'cvr_' || substring("id" from 5)
  WHERE "id" LIKE 'cmr\_%';
END $$;
