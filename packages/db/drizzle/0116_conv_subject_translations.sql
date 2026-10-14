-- conv_subject_translations holds a teammate-facing rendering of a
-- conversation's subject in one target language (the dashboard locale that
-- asked for it), alongside conv_message_translations. source_subject is the
-- subject the translation was made from: a row only applies while it still
-- equals conv_conversations.subject, so a retitled conversation never shows a
-- translation of its old title. The tenant_isolation policy lives in conv.sql
-- and hides every row from end-user audiences.
CREATE TABLE IF NOT EXISTS "conv_subject_translations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"target_language" varchar(16) NOT NULL,
	"source_subject" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conv_subject_translations" ADD CONSTRAINT "conv_subject_translations_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conv_subject_translations" ADD CONSTRAINT "conv_subject_translations_conversation_id_conv_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conv_conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conv_subject_translations_conv_target_uq" ON "conv_subject_translations" USING btree ("conversation_id","target_language");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conv_subject_translations_org_idx" ON "conv_subject_translations" USING btree ("org_id");
