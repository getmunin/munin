-- Repair email channels written by the removed free-form `conv_create_channel`
-- tool. That path persisted the caller's `config` verbatim, so an SMTP/IMAP block
-- could land without the `encryptedPassword` slot the stored-config schema
-- requires. Every read of such a channel then failed validation: the
-- credential-handoff link could not describe its fields and the dashboard could
-- not save into it, while the row still reported active. The configure path
-- writes the slot as an empty string and leaves the channel inactive until a
-- password arrives — this brings the stragglers to that state so the existing
-- credential link repairs them.
--
-- The same path could persist a plaintext `password` (secrets are meant to be
-- pgcrypto-encrypted into `encryptedPassword`); those keys are dropped rather
-- than migrated, since nothing ever read them and the operator re-enters the
-- password through the link.
--
-- conv_channels is FORCE RLS, so the migration role sees zero rows without the
-- bypass. Idempotent: each statement only matches blocks still in the bad shape.
DO $$
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);

  UPDATE conv_channels
  SET config = jsonb_set(config, '{outbound,encryptedPassword}', '""'::jsonb),
      active = false,
      updated_at = now()
  WHERE type = 'email'
    AND config -> 'outbound' ->> 'provider' = 'smtp'
    AND NOT (config -> 'outbound' ? 'encryptedPassword');

  UPDATE conv_channels
  SET config = jsonb_set(config, '{inbound,encryptedPassword}', '""'::jsonb),
      active = false,
      updated_at = now()
  WHERE type = 'email'
    AND jsonb_typeof(config -> 'inbound') = 'object'
    AND NOT (config -> 'inbound' ? 'encryptedPassword');

  UPDATE conv_channels
  SET config = (config #- '{outbound,password}') #- '{inbound,password}',
      updated_at = now()
  WHERE type = 'email'
    AND ((config -> 'outbound' ? 'password') OR (config -> 'inbound' ? 'password'));
END $$;
