-- Channel-adapter seam migration.
--
-- 1) Generic inbound-state cursor table (replaces email-specific
--    conv_email_inbound_state). Email's lastUidSeen migrates into
--    cursor.lastUid; future poll-mode adapters use whatever cursor shape
--    they need.
-- 2) Optional channel binding on api_keys for widget keys (mn_widget_*).
-- 3) Partial unique indexes for chat-widget idempotency:
--    - conv_messages by metadata->>'providerMessageId'
--    - conv_conversations by (org_id, channel_id, metadata->>'sessionId')

CREATE TABLE "conv_inbound_state" (
  "channel_id" text PRIMARY KEY NOT NULL,
  "cursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_polled_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "conv_inbound_state"
  ADD CONSTRAINT "conv_inbound_state_channel_id_conv_channels_id_fk"
  FOREIGN KEY ("channel_id") REFERENCES "public"."conv_channels"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

INSERT INTO "conv_inbound_state" (channel_id, cursor, last_polled_at, last_error, created_at, updated_at)
SELECT channel_id,
       jsonb_build_object('lastUid', last_uid_seen),
       last_polled_at,
       last_error,
       created_at,
       updated_at
FROM "conv_email_inbound_state"
ON CONFLICT (channel_id) DO NOTHING;
--> statement-breakpoint

DROP TABLE "conv_email_inbound_state";
--> statement-breakpoint

ALTER TABLE "api_keys" ADD COLUMN "channel_id" text;
--> statement-breakpoint

ALTER TABLE "api_keys"
  ADD CONSTRAINT "api_keys_channel_id_conv_channels_id_fk"
  FOREIGN KEY ("channel_id") REFERENCES "public"."conv_channels"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX "api_keys_channel_idx" ON "api_keys" ("channel_id");
--> statement-breakpoint

-- Partial unique expression indexes for chat-widget ingestion idempotency.
-- Use `metadata ? 'key'` in WHERE clauses so the planner picks these up.

CREATE UNIQUE INDEX "conv_messages_provider_msgid_uq"
  ON "conv_messages" ((metadata->>'providerMessageId'))
  WHERE metadata ? 'providerMessageId';
--> statement-breakpoint

CREATE UNIQUE INDEX "conv_conversations_session_uq"
  ON "conv_conversations" (org_id, channel_id, (metadata->>'sessionId'))
  WHERE metadata ? 'sessionId';
