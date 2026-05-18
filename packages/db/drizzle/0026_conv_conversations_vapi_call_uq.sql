CREATE UNIQUE INDEX IF NOT EXISTS "conv_conversations_vapi_call_uq"
  ON "conv_conversations" ("org_id", "channel_id", (("metadata" ->> 'vapiCallId')))
  WHERE ("metadata" ->> 'vapiCallId') IS NOT NULL;
