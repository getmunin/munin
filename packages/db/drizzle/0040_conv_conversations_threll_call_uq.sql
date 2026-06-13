CREATE UNIQUE INDEX IF NOT EXISTS "conv_conversations_threll_call_uq"
  ON "conv_conversations" ("org_id", "channel_id", (("metadata" ->> 'threllCallId')))
  WHERE ("metadata" ->> 'threllCallId') IS NOT NULL;
