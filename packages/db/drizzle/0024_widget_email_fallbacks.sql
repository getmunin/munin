CREATE TABLE IF NOT EXISTS "conv_widget_email_fallbacks" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
  "conversation_id" text NOT NULL REFERENCES "conv_conversations"("id") ON DELETE CASCADE,
  "end_user_id" text NOT NULL REFERENCES "end_users"("id") ON DELETE CASCADE,
  "email_channel_id" text NOT NULL REFERENCES "conv_channels"("id") ON DELETE CASCADE,
  "trigger_message_id" text NOT NULL REFERENCES "conv_messages"("id") ON DELETE CASCADE,
  "last_engagement_at" timestamptz NOT NULL,
  "message_id_header" text,
  "message_count" integer NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'queued',
  "error" text,
  "sent_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "conv_widget_email_fallbacks_conv_engagement_uq"
  ON "conv_widget_email_fallbacks" ("conversation_id", "last_engagement_at");
CREATE INDEX IF NOT EXISTS "conv_widget_email_fallbacks_org_idx"
  ON "conv_widget_email_fallbacks" ("org_id");
CREATE INDEX IF NOT EXISTS "conv_widget_email_fallbacks_status_idx"
  ON "conv_widget_email_fallbacks" ("status");
