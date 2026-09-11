-- Clear placeholder sender names captured from inbound mail.
--
-- A From header whose display name carries no letters or digits — "?" is the one seen
-- in the wild, from a client that fills the field rather than omitting it — was stored
-- verbatim as the contact's name. Every surface that prefers a name over an address then
-- showed that punctuation instead of the address: the queue row, the conversation
-- header, each message bubble, the CRM record, the Slack mirror.
--
-- Ingest now drops such names (senderDisplayName), so the rows below are the backlog.
-- Nulling the name is the whole repair: name-or-address fallbacks all resolve to the
-- address on their own once the name is gone.
--
-- The predicate is deliberately narrow — a name made up entirely of whitespace and
-- ASCII punctuation. It matches no real name under any lc_ctype, including names in
-- non-latin scripts, whose characters fall outside both classes.
--
-- Re-runnable: the UPDATEs stop matching once they have run.

DO $$
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);

  UPDATE conv_contacts
  SET name = NULL, updated_at = now()
  WHERE name IS NOT NULL
    AND name ~ '^[[:space:][:punct:]]*$';

  UPDATE end_users
  SET name = NULL, updated_at = now()
  WHERE name IS NOT NULL
    AND name ~ '^[[:space:][:punct:]]*$';

  UPDATE crm_contacts
  SET name = NULL, updated_at = now()
  WHERE name IS NOT NULL
    AND name ~ '^[[:space:][:punct:]]*$';
END $$;
