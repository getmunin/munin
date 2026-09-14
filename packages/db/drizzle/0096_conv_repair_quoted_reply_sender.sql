-- Repair inbound mail whose sender was read off the quoted block of a reply.
--
-- FORWARD_MARKERS counts a rule of ten or more underscores as a forward marker.
-- Outlook writes exactly that rule above the header block it quotes, on replies as
-- much as on forwards, so resolveForwardOrigin read the quoted `From:` — the address
-- the customer was answering, which is the organisation's own support address — and
-- recorded it as the sender. The human who actually wrote the mail was demoted to
-- metadata.forwarding.forwardedBy.
--
-- Every reply arriving that way collapsed onto one contact: the org's own address.
-- Unrelated customers shared a single identity and a single conversation history, and
-- an approved draft would have been addressed back at the mailbox it came from.
--
-- The real sender is recovered from forwardedBy, which is the envelope From and was
-- always right. A display name is lifted from the quoted recipient line when one sits
-- there, and left null otherwise: a wrong name reaches the customer in a greeting, a
-- missing one only shows the address.
--
-- Ids are derived from (org, address) so a re-run converges on the same rows instead
-- of minting a second contact. Re-runnable: every statement is predicate-guarded.

DO $$
DECLARE
  broken RECORD;
  v_name text;
  v_end_user_id text;
  v_contact_id text;
  v_repaired integer := 0;
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);

  FOR broken IN
    SELECT m.id                                              AS message_id,
           m.org_id                                          AS org_id,
           m.conversation_id                                 AS conversation_id,
           m.author_id                                       AS wrong_contact_id,
           lower(m.metadata->'forwarding'->>'forwardedBy')   AS sender_address,
           coalesce(m.metadata->>'preStripBody', m.body, '') AS quoted_source
      FROM conv_messages m
      JOIN conv_conversations c ON c.id = m.conversation_id
      JOIN conv_channels ch     ON ch.id = c.channel_id
      JOIN conv_contacts ct     ON ct.id = m.author_id
     WHERE m.author_type = 'end_user'
       AND m.metadata->'forwarding'->>'kind' = 'manual-forward'
       AND m.metadata->'forwarding'->>'forwardedBy' IS NOT NULL
       AND ct.email IS NOT NULL
       AND lower(ct.email) IN (
             lower(ch.config->'addressing'->>'fromAddress'),
             lower(ch.config->'inbound'->>'address')
           )
       AND lower(m.metadata->'forwarding'->>'forwardedBy') <> lower(ct.email)
     ORDER BY m.created_at ASC
  LOOP
    -- The quoted recipient line names the person who replied: "Til: Kari <kari@x.no>".
    -- Anything that does not read as a bare display name is discarded.
    SELECT trim(both ' "''' from split_part(substr(l, position(':' in l) + 1), '<', 1))
      INTO v_name
      FROM unnest(string_to_array(broken.quoted_source, E'\n')) AS l
     WHERE position(broken.sender_address in lower(l)) > 0
       AND position('<' in l) > 1
       AND position(':' in l) > 0
       AND position(':' in l) < position('<' in l)
     LIMIT 1;

    IF v_name IS NOT NULL
       AND (v_name = ''
            OR length(v_name) > 120
            OR v_name LIKE '%@%'
            OR v_name LIKE '%/%') THEN
      v_name := NULL;
    END IF;

    SELECT eu.id INTO v_end_user_id
      FROM end_users eu
     WHERE eu.org_id = broken.org_id AND lower(eu.email) = broken.sender_address
     LIMIT 1;

    IF v_end_user_id IS NULL THEN
      INSERT INTO end_users (id, org_id, external_id, email, name)
      VALUES ('eu_' || substr(md5(broken.org_id || ':' || broken.sender_address), 1, 22),
              broken.org_id,
              'email:' || broken.sender_address,
              broken.sender_address,
              v_name)
      ON CONFLICT DO NOTHING;

      SELECT eu.id INTO v_end_user_id
        FROM end_users eu
       WHERE eu.org_id = broken.org_id AND lower(eu.email) = broken.sender_address
       LIMIT 1;
    END IF;

    SELECT ct.id INTO v_contact_id
      FROM conv_contacts ct
     WHERE ct.org_id = broken.org_id AND lower(ct.email) = broken.sender_address
     ORDER BY ct.created_at ASC
     LIMIT 1;

    IF v_contact_id IS NULL THEN
      v_contact_id := 'ctc_' || substr(md5(broken.org_id || ':' || broken.sender_address), 1, 22);
      INSERT INTO conv_contacts (id, org_id, end_user_id, email, name)
      VALUES (v_contact_id, broken.org_id, v_end_user_id, broken.sender_address, v_name)
      ON CONFLICT DO NOTHING;
    ELSE
      UPDATE conv_contacts ct
         SET end_user_id = coalesce(ct.end_user_id, v_end_user_id),
             name = coalesce(ct.name, v_name),
             updated_at = now()
       WHERE ct.id = v_contact_id;
    END IF;

    UPDATE conv_messages m
       SET author_id = v_contact_id
     WHERE m.id = broken.message_id
       AND m.author_id = broken.wrong_contact_id;

    UPDATE conv_conversations c
       SET contact_id = v_contact_id,
           end_user_id = v_end_user_id,
           updated_at = now()
     WHERE c.id = broken.conversation_id
       AND c.contact_id = broken.wrong_contact_id;

    v_repaired := v_repaired + 1;
  END LOOP;

  IF v_repaired > 0 THEN
    RAISE NOTICE 'conv_messages: reattributed % message(s) misread as a manual forward', v_repaired;
  END IF;

  -- The organisation's own address is left behind as a contact nothing points at.
  DELETE FROM conv_contacts ct
   WHERE ct.email IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM conv_channels ch
        WHERE ch.org_id = ct.org_id
          AND lower(ct.email) IN (
                lower(ch.config->'addressing'->>'fromAddress'),
                lower(ch.config->'inbound'->>'address')
              )
     )
     AND NOT EXISTS (SELECT 1 FROM conv_messages m WHERE m.author_id = ct.id)
     AND NOT EXISTS (SELECT 1 FROM conv_conversations c WHERE c.contact_id = ct.id);
END $$;
