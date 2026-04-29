CREATE TABLE "conv_channels" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"type" varchar(16) NOT NULL,
	"name" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conv_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"end_user_id" text,
	"name" text,
	"email" text,
	"phone" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conv_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"display_id" integer NOT NULL,
	"channel_id" text NOT NULL,
	"contact_id" text,
	"end_user_id" text,
	"topic_id" text,
	"assignee_user_id" text,
	"subject" text,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"snooze_until" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conv_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"author_type" varchar(16) NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"body_html" text,
	"internal" boolean DEFAULT false NOT NULL,
	"in_reply_to_id" text,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conv_topics" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" varchar(64) NOT NULL,
	"color" varchar(16),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conv_channels" ADD CONSTRAINT "conv_channels_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conv_contacts" ADD CONSTRAINT "conv_contacts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conv_contacts" ADD CONSTRAINT "conv_contacts_end_user_id_end_users_id_fk" FOREIGN KEY ("end_user_id") REFERENCES "public"."end_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conv_conversations" ADD CONSTRAINT "conv_conversations_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conv_conversations" ADD CONSTRAINT "conv_conversations_channel_id_conv_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."conv_channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conv_conversations" ADD CONSTRAINT "conv_conversations_contact_id_conv_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."conv_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conv_conversations" ADD CONSTRAINT "conv_conversations_end_user_id_end_users_id_fk" FOREIGN KEY ("end_user_id") REFERENCES "public"."end_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conv_conversations" ADD CONSTRAINT "conv_conversations_topic_id_conv_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."conv_topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conv_conversations" ADD CONSTRAINT "conv_conversations_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conv_messages" ADD CONSTRAINT "conv_messages_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conv_messages" ADD CONSTRAINT "conv_messages_conversation_id_conv_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conv_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conv_topics" ADD CONSTRAINT "conv_topics_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conv_channels_org_idx" ON "conv_channels" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "conv_channels_type_idx" ON "conv_channels" USING btree ("org_id","type");--> statement-breakpoint
CREATE INDEX "conv_contacts_org_idx" ON "conv_contacts" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "conv_contacts_email_idx" ON "conv_contacts" USING btree ("org_id","email");--> statement-breakpoint
CREATE INDEX "conv_contacts_end_user_idx" ON "conv_contacts" USING btree ("end_user_id");--> statement-breakpoint
CREATE INDEX "conv_conversations_org_idx" ON "conv_conversations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "conv_conversations_status_idx" ON "conv_conversations" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "conv_conversations_end_user_idx" ON "conv_conversations" USING btree ("end_user_id");--> statement-breakpoint
CREATE INDEX "conv_conversations_contact_idx" ON "conv_conversations" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conv_conversations_display_uq" ON "conv_conversations" USING btree ("org_id","display_id");--> statement-breakpoint
CREATE INDEX "conv_conversations_last_msg_idx" ON "conv_conversations" USING btree ("org_id","last_message_at");--> statement-breakpoint
CREATE INDEX "conv_messages_conv_idx" ON "conv_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "conv_messages_org_idx" ON "conv_messages" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "conv_topics_org_idx" ON "conv_topics" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conv_topics_org_slug_uq" ON "conv_topics" USING btree ("org_id","slug");