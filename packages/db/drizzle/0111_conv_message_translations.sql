-- Inbox translation. customer_language is the language the customer writes
-- in, as a short BCP 47 tag ("es", "de"), detected by the agent the first time
-- a teammate opens the conversation; NULL until then.
--
-- conv_message_translations holds a teammate-facing rendering of one message
-- in one target language (the dashboard locale that asked for it). Rows are
-- deleted with the message, and whenever a message body is rewritten, so a
-- redacted body never keeps an unredacted translation. The tenant_isolation
-- policy lives in conv.sql and hides every row from end-user audiences.
ALTER TABLE "conv_conversations" ADD COLUMN IF NOT EXISTS "customer_language" varchar(16);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conv_message_translations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"message_id" text NOT NULL,
	"target_language" varchar(16) NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conv_message_translations" ADD CONSTRAINT "conv_message_translations_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conv_message_translations" ADD CONSTRAINT "conv_message_translations_conversation_id_conv_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conv_conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conv_message_translations" ADD CONSTRAINT "conv_message_translations_message_id_conv_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."conv_messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conv_message_translations_message_target_uq" ON "conv_message_translations" USING btree ("message_id","target_language");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conv_message_translations_conv_idx" ON "conv_message_translations" USING btree ("conversation_id","target_language");
