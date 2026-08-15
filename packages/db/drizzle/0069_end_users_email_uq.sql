-- One end_user per email address per org, so the email channel and the analytics
-- tracker's identify call converge on the same identity row instead of racing to
-- create two. Case-insensitive: the email channel lowercases on write, identify
-- normalizes, but pre-existing rows were never constrained.
--
-- Existing duplicates are merged first, deterministically. They are the same human
-- by construction — one address, one org — so the only real decision is which row
-- survives, and that is ordered rather than guessed:
--   1. a row with a real external_id beats a provisional 'email:<address>' one,
--      because other systems reference the real id
--   2. then the oldest row, which is the one most likely already referenced
--   3. then by id, so the outcome is stable across reruns and replicas
-- Everything pointing at a loser is repointed to the keeper before it is deleted,
-- so no conversation, contact or event is detached. Read receipts are the one place
-- that needs care: (message_id, end_user_id) is unique, and duplicates can sit on
-- the keeper *and* on two different losers, so all but the earliest read per message
-- is dropped before repointing. A read receipt is a boolean fact — which row carries
-- it does not matter, only that exactly one survives.
DO $$
DECLARE
  dup RECORD;
  keeper_id text;
  loser_ids text[];
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);

  FOR dup IN
    SELECT org_id, lower(email) AS email_key
      FROM end_users
     WHERE email IS NOT NULL
     GROUP BY 1, 2
    HAVING count(*) > 1
  LOOP
    SELECT id INTO keeper_id
      FROM end_users
     WHERE org_id = dup.org_id AND lower(email) = dup.email_key
     ORDER BY (external_id IS NOT NULL AND external_id NOT LIKE 'email:%') DESC,
              created_at ASC,
              id ASC
     LIMIT 1;

    SELECT array_agg(id) INTO loser_ids
      FROM end_users
     WHERE org_id = dup.org_id AND lower(email) = dup.email_key AND id <> keeper_id;

    RAISE NOTICE 'end_users: merging % duplicate identities for % into %',
      array_length(loser_ids, 1), dup.email_key, keeper_id;

    DELETE FROM conv_message_reads r
     WHERE r.end_user_id = ANY(loser_ids)
       AND EXISTS (
         SELECT 1 FROM conv_message_reads k
          WHERE k.message_id = r.message_id
            AND k.id <> r.id
            AND (
              k.end_user_id = keeper_id
              OR (k.end_user_id = ANY(loser_ids)
                  AND (k.created_at, k.id) < (r.created_at, r.id))
            )
       );

    UPDATE conv_message_reads          SET end_user_id = keeper_id WHERE end_user_id = ANY(loser_ids);
    UPDATE conv_contacts               SET end_user_id = keeper_id WHERE end_user_id = ANY(loser_ids);
    UPDATE conv_conversations          SET end_user_id = keeper_id WHERE end_user_id = ANY(loser_ids);
    UPDATE conv_widget_email_fallbacks SET end_user_id = keeper_id WHERE end_user_id = ANY(loser_ids);
    UPDATE crm_contacts                SET end_user_id = keeper_id WHERE end_user_id = ANY(loser_ids);
    UPDATE crm_activities              SET end_user_id = keeper_id WHERE end_user_id = ANY(loser_ids);
    UPDATE analytics_view_events       SET end_user_id = keeper_id WHERE end_user_id = ANY(loser_ids);
    UPDATE analytics_search_events     SET end_user_id = keeper_id WHERE end_user_id = ANY(loser_ids);
    UPDATE analytics_visitor_identities SET end_user_id = keeper_id WHERE end_user_id = ANY(loser_ids);
    UPDATE tokens                      SET end_user_id = keeper_id WHERE end_user_id = ANY(loser_ids);

    UPDATE end_users k
       SET name  = COALESCE(k.name,  (SELECT l.name  FROM end_users l
                                       WHERE l.id = ANY(loser_ids) AND l.name IS NOT NULL
                                       ORDER BY l.created_at ASC LIMIT 1)),
           phone = COALESCE(k.phone, (SELECT l.phone FROM end_users l
                                       WHERE l.id = ANY(loser_ids) AND l.phone IS NOT NULL
                                       ORDER BY l.created_at ASC LIMIT 1)),
           updated_at = now()
     WHERE k.id = keeper_id;

    DELETE FROM end_users WHERE id = ANY(loser_ids);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "end_users_org_email_uq" ON "end_users" USING btree ("org_id",lower("email")) WHERE "end_users"."email" IS NOT NULL;
