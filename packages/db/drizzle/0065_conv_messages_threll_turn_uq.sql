DO $$
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);

  -- Threll has redelivered whole call transcripts before this fix landed,
  -- storing each turn twice. Keep the earliest copy of each turn, drop the rest.
  DELETE FROM conv_messages cm
  USING (
    SELECT id, row_number() OVER (
      PARTITION BY conversation_id, (metadata ->> 'threllCallId'), (metadata ->> 'voiceTurnIndex'), (metadata ->> 'threllRole')
      ORDER BY created_at, id
    ) AS rn
    FROM conv_messages
    WHERE (metadata ->> 'threllCallId') IS NOT NULL
  ) dup
  WHERE cm.id = dup.id AND dup.rn > 1;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "conv_messages_threll_turn_uq"
  ON "conv_messages" ("conversation_id", (("metadata" ->> 'threllCallId')), (("metadata" ->> 'voiceTurnIndex')), (("metadata" ->> 'threllRole')))
  WHERE ("metadata" ->> 'threllCallId') IS NOT NULL;
