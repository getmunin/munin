-- Outreach broadcasts: one approved message sent to a whole CRM segment.
-- A broadcast is pending until a signed-in person approves it; approval
-- freezes the audience into outreach_broadcast_recipients (one row per
-- distinct address) and snapshots the compiled HTML in approved_html, so a
-- later template or segment edit never changes what an approved send delivers.
-- Recipients get no conversation up front: conv_conversations is only created
-- when someone replies, linked back through outreach_broadcast_id.
-- Tenant isolation policies live in outreach.sql.
CREATE TABLE IF NOT EXISTS "outreach_broadcasts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"segment_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"email_template_id" text,
	"subject" text NOT NULL,
	"preheader" text,
	"content_format" varchar(16) NOT NULL,
	"body" text NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"scheduled_send_at" timestamp with time zone,
	"max_per_hour" integer,
	"approved_html" text,
	"approved_fingerprint" varchar(64),
	"approved_audience_count" integer,
	"proposed_by_actor_type" varchar(16) NOT NULL,
	"proposed_by_actor_id" text NOT NULL,
	"decided_by_actor_type" varchar(16),
	"decided_by_actor_id" text,
	"decided_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"dismiss_reason" text,
	"cancel_reason" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outreach_broadcast_recipients" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"broadcast_id" text NOT NULL,
	"contact_id" text,
	"address" text NOT NULL,
	"status" varchar(16) DEFAULT 'queued' NOT NULL,
	"skip_reason" varchar(32),
	"failure_reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"message_id_header" text,
	"sent_at" timestamp with time zone,
	"conversation_id" text,
	"replied_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "conv_conversations" ADD COLUMN IF NOT EXISTS "outreach_broadcast_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach_broadcasts" ADD CONSTRAINT "outreach_broadcasts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach_broadcasts" ADD CONSTRAINT "outreach_broadcasts_segment_id_crm_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."crm_segments"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach_broadcasts" ADD CONSTRAINT "outreach_broadcasts_channel_id_conv_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."conv_channels"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach_broadcasts" ADD CONSTRAINT "outreach_broadcasts_email_template_id_outreach_email_templates_id_fk" FOREIGN KEY ("email_template_id") REFERENCES "public"."outreach_email_templates"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach_broadcast_recipients" ADD CONSTRAINT "outreach_broadcast_recipients_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach_broadcast_recipients" ADD CONSTRAINT "outreach_broadcast_recipients_broadcast_id_outreach_broadcasts_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."outreach_broadcasts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach_broadcast_recipients" ADD CONSTRAINT "outreach_broadcast_recipients_contact_id_crm_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."crm_contacts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach_broadcast_recipients" ADD CONSTRAINT "outreach_broadcast_recipients_conversation_id_conv_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conv_conversations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conv_conversations" ADD CONSTRAINT "conv_conversations_outreach_broadcast_id_outreach_broadcasts_id_fk" FOREIGN KEY ("outreach_broadcast_id") REFERENCES "public"."outreach_broadcasts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_broadcasts_org_status_idx" ON "outreach_broadcasts" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "outreach_broadcasts_org_name_uq" ON "outreach_broadcasts" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_broadcasts_due_idx" ON "outreach_broadcasts" USING btree ("scheduled_send_at") WHERE status IN ('approved', 'sending');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "outreach_broadcast_recipients_address_uq" ON "outreach_broadcast_recipients" USING btree ("broadcast_id","address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_broadcast_recipients_status_idx" ON "outreach_broadcast_recipients" USING btree ("broadcast_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_broadcast_recipients_message_id_idx" ON "outreach_broadcast_recipients" USING btree ("org_id","message_id_header") WHERE message_id_header IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_broadcast_recipients_contact_idx" ON "outreach_broadcast_recipients" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conv_conversations_outreach_broadcast_idx" ON "conv_conversations" USING btree ("outreach_broadcast_id") WHERE outreach_broadcast_id IS NOT NULL;
