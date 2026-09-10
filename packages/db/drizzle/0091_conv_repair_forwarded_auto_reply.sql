-- Repair inbound mail that a forwarding hop got misclassified as an auto-reply.
--
-- `classifySender` treated the bare presence of `X-Auto-Response-Suppress`, and any
-- `Auto-Submitted` value other than `no`, as proof of machine mail. A mailbox that
-- auto-forwards into Munin (Microsoft 365 with SRS) stamps both on the forwarded copy,
-- so every human email arriving that way classified as an auto-reply. Harmless until
-- suppression started acting on the flag, at which point those messages lost their
-- attention flag, their agent draft, their Slack mirror and their place in the
-- awaiting-reply sweep.
--
-- Four repairs, in order:
--   1. drop the suppression from forwarded human mail,
--   2. correct the stale classification on forwarded mail that was never suppressed,
--   3. flag for attention again the repaired threads where the customer spoke last,
--   4. close conversations whose every public message is a genuine suppressed
--      auto-reply, which is the state 0938's ingest-time close would have produced.
--
-- The agent turn those messages lost is not replayed here — drafting is driven by a
-- `conversation.draft_requested` event whose NOTIFY needs a live listener, which a
-- migration cannot rely on. Step 1 stamps `metadata.autoReplyRepair = 'unsuppressed'`,
-- so the repaired messages stay findable for whoever picks the drafts up afterwards.
--
-- Genuine out-of-office mail is kept suppressed: it is recognised by an auto-reply
-- subject (the same prefixes classify-sender.ts matches, diacritics folded) or by an
-- unmistakable out-of-office phrase in the body. Anything ambiguous stays suppressed —
-- a wrongly suppressed message is recoverable, a robot answered as a customer is not.
--
-- Re-runnable: every statement is predicate-guarded.

DO $$
DECLARE
  auto_reply_subject CONSTANT text :=
    '^(automatisk svar|automatisk fravaer|fravaer|autosvar|automatiskt svar|fravaerende|fravarande|franvarande|ute av kontoret|out of office|out of the office|automatic reply|auto reply|auto-reply|autoreply|automatische antwort|abwesenheitsnotiz|reponse automatique)\s*[:\-–]';
  auto_reply_body CONSTANT text :=
    '(out of (the )?office|automatic reply|automatisk svar|autosvar|ute av kontoret|fravaerende|fraværende|abwesenheitsnotiz|automatische antwort|reponse automatique|réponse automatique|annual leave|parental leave|i am currently away)';
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);

  CREATE TEMP TABLE repair_candidates ON COMMIT DROP AS
  SELECT m.id
  FROM conv_messages m
  JOIN conv_conversations c ON c.id = m.conversation_id
  WHERE m.metadata->'forwarding'->>'kind' = 'auto-forward'
    AND regexp_replace(
          translate(
            replace(replace(replace(lower(coalesce(c.subject, '')), 'æ', 'ae'), 'ø', 'oe'), 'ß', 'ss'),
            'åäàáâöòóôüùúûéèêëíìîïñç',
            'aaaaaooooouuuueeeeiiiinc'
          ),
          '^((re|sv|svar|aw|fwd?|vs|vb)\s*:\s*)+', '', 'i'
        ) !~ auto_reply_subject
    AND coalesce(m.body, '') !~* auto_reply_body;

  UPDATE conv_messages m
  SET metadata = (m.metadata - 'suppressed')
    || jsonb_build_object(
         'senderClassification',
         coalesce(m.metadata->'senderClassification', '{}'::jsonb)
           || jsonb_build_object('isAutoReply', false, 'autoReplySignal', NULL),
         'autoReplyRepair', 'unsuppressed'
       )
  WHERE m.id IN (SELECT id FROM repair_candidates)
    AND m.metadata->>'suppressed' = 'auto_reply';

  UPDATE conv_messages m
  SET metadata = m.metadata
    || jsonb_build_object(
         'senderClassification',
         (m.metadata->'senderClassification')
           || jsonb_build_object('isAutoReply', false, 'autoReplySignal', NULL)
       )
  WHERE m.id IN (SELECT id FROM repair_candidates)
    AND m.metadata->>'suppressed' IS NULL
    AND (m.metadata->'senderClassification'->>'isAutoReply')::boolean IS TRUE;

  UPDATE conv_conversations c
  SET needs_human_attention = TRUE,
      needs_human_attention_at = coalesce(c.needs_human_attention_at, c.last_message_at, now()),
      updated_at = now()
  WHERE c.status = 'open'
    AND c.needs_human_attention = FALSE
    AND c.assignee_user_id IS NULL
    AND EXISTS (
      SELECT 1 FROM conv_messages m
      WHERE m.conversation_id = c.id
        AND m.metadata->>'autoReplyRepair' = 'unsuppressed'
    )
    AND (
      SELECT m.author_type FROM conv_messages m
      WHERE m.conversation_id = c.id AND m.internal = FALSE
      ORDER BY m.created_at DESC
      LIMIT 1
    ) = 'end_user';

  UPDATE conv_conversations c
  SET status = 'closed',
      updated_at = now()
  WHERE c.status = 'open'
    AND EXISTS (
      SELECT 1 FROM conv_messages m
      WHERE m.conversation_id = c.id AND m.internal = FALSE
    )
    AND NOT EXISTS (
      SELECT 1 FROM conv_messages m
      WHERE m.conversation_id = c.id
        AND m.internal = FALSE
        AND coalesce(m.metadata->>'suppressed', '') <> 'auto_reply'
    );
END $$;
