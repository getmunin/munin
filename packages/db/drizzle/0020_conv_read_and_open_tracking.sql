ALTER TABLE "conv_message_deliveries"
  ADD COLUMN IF NOT EXISTS "first_opened_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "last_opened_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "open_count" integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "conv_message_reads" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
  "conversation_id" text NOT NULL REFERENCES "conv_conversations"("id") ON DELETE CASCADE,
  "message_id" text NOT NULL REFERENCES "conv_messages"("id") ON DELETE CASCADE,
  "end_user_id" text NOT NULL REFERENCES "end_users"("id") ON DELETE CASCADE,
  "read_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "conv_message_reads_message_user_uq"
  ON "conv_message_reads" ("message_id", "end_user_id");
CREATE INDEX IF NOT EXISTS "conv_message_reads_conv_idx"
  ON "conv_message_reads" ("org_id", "conversation_id");
CREATE INDEX IF NOT EXISTS "conv_message_reads_msg_idx"
  ON "conv_message_reads" ("message_id");
