CREATE TABLE IF NOT EXISTS "conv_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"message_id" text,
	"session_id" text,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"width" integer,
	"height" integer,
	"variants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"storage_provider" varchar(16) NOT NULL,
	"storage_key" text,
	"inline" boolean DEFAULT false NOT NULL,
	"content_id" text,
	"uploaded" boolean DEFAULT false NOT NULL,
	"created_by_type" varchar(16) NOT NULL,
	"created_by_id" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by_type" varchar(16),
	"deleted_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- ADD CONSTRAINT has no IF NOT EXISTS form, so each FK is guarded against
-- pg_constraint: the migration must be safely re-runnable if its journal
-- timestamp is ever corrected (see packages/db/src/migrations-journal.test.ts).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conv_attachments_org_id_orgs_id_fk') THEN
    ALTER TABLE "conv_attachments" ADD CONSTRAINT "conv_attachments_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conv_attachments_conversation_id_conv_conversations_id_fk') THEN
    ALTER TABLE "conv_attachments" ADD CONSTRAINT "conv_attachments_conversation_id_conv_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conv_conversations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conv_attachments_message_id_conv_messages_id_fk') THEN
    ALTER TABLE "conv_attachments" ADD CONSTRAINT "conv_attachments_message_id_conv_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."conv_messages"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conv_attachments_org_idx" ON "conv_attachments" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conv_attachments_conv_idx" ON "conv_attachments" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conv_attachments_msg_idx" ON "conv_attachments" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conv_attachments_key_uq" ON "conv_attachments" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conv_attachments_pending_idx" ON "conv_attachments" USING btree ("uploaded","created_at");
