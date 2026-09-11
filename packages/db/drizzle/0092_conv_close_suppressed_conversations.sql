-- Close conversations that exist only to hold machine mail.
--
-- `suppressionReason` reported `bounce` before `auto_reply`, and `isBounce` took a
-- `postmaster@` envelope sender as proof of a delivery failure. That is the envelope
-- sender Microsoft 365 puts on an out-of-office reply, so every M365 vacation reply
-- was stored as `suppressed = 'bounce'`. The ingest-time close in 0938 only closed a
-- new conversation when the reason was `auto_reply`, and 0091 step 4 only closed a
-- conversation whose every public message was `auto_reply` — so these threads stayed
-- open and filled the operator's in-progress queue.
--
-- Two repairs:
--   1. correct the stale classification on out-of-office mail stamped as a bounce,
--   2. close every open conversation whose public messages are all suppressed,
--      whatever the reason — the state the corrected ingest path now produces for
--      auto-replies and bounces alike.
--
-- Step 1 is deliberately narrow. A message's Content-Type and X-Failed-Recipients are
-- not persisted, so a genuine delivery-status report cannot be told apart from an
-- out-of-office by metadata alone; the relabel therefore requires positive out-of-office
-- evidence — an auto-reply subject (the prefixes classify-sender.ts matches, diacritics
-- folded) or an unmistakable body phrase — and leaves everything else labelled `bounce`.
-- Nothing rides on the distinction for the close in step 2, which treats both the same.
--
-- Re-runnable: every statement is predicate-guarded.

DO $$
DECLARE
  auto_reply_subject CONSTANT text :=
    '^(automatisk svar|automatisk fravaer|fravaer|autosvar|automatiskt svar|fravaerende|fravarande|franvarande|ute av kontoret|out of office|out of the office|automatic reply|auto reply|auto-reply|autoreply|automatische antwort|abwesenheitsnotiz|reponse automatique)';
  auto_reply_body CONSTANT text :=
    '(out of (the )?office|automatic reply|automatisk svar|autosvar|ute av kontoret|fravaerende|fraværende|abwesenheitsnotiz|automatische antwort|reponse automatique|réponse automatique|annual leave|parental leave|i am currently away)';
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);

  UPDATE conv_messages m
  SET metadata = m.metadata
    || jsonb_build_object('suppressed', 'auto_reply')
    || jsonb_build_object(
         'senderClassification',
         coalesce(m.metadata->'senderClassification', '{}'::jsonb)
           || jsonb_build_object('isBounce', false, 'isAutoReply', true)
       )
  FROM conv_conversations c
  WHERE c.id = m.conversation_id
    AND m.metadata->>'suppressed' = 'bounce'
    AND (
      regexp_replace(
        translate(
          replace(replace(replace(lower(coalesce(c.subject, '')), 'æ', 'ae'), 'ø', 'oe'), 'ß', 'ss'),
          'åäàáâöòóôüùúûéèêëíìîïñç',
          'aaaaaooooouuuueeeeiiiinc'
        ),
        '^((re|sv|svar|aw|fwd?|vs|vb)\s*:\s*)+', '', 'i'
      ) ~ auto_reply_subject
      OR coalesce(m.body, '') ~* auto_reply_body
    );

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
        AND m.metadata->>'suppressed' IS NULL
    );
END $$;
