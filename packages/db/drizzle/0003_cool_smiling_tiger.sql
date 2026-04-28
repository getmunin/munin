CREATE TABLE "desk_channels" (
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
CREATE TABLE "desk_contacts" (
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
CREATE TABLE "desk_conversations" (
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
CREATE TABLE "desk_messages" (
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
CREATE TABLE "desk_topics" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" varchar(64) NOT NULL,
	"color" varchar(16),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "desk_channels" ADD CONSTRAINT "desk_channels_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desk_contacts" ADD CONSTRAINT "desk_contacts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desk_contacts" ADD CONSTRAINT "desk_contacts_end_user_id_end_users_id_fk" FOREIGN KEY ("end_user_id") REFERENCES "public"."end_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desk_conversations" ADD CONSTRAINT "desk_conversations_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desk_conversations" ADD CONSTRAINT "desk_conversations_channel_id_desk_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."desk_channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desk_conversations" ADD CONSTRAINT "desk_conversations_contact_id_desk_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."desk_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desk_conversations" ADD CONSTRAINT "desk_conversations_end_user_id_end_users_id_fk" FOREIGN KEY ("end_user_id") REFERENCES "public"."end_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desk_conversations" ADD CONSTRAINT "desk_conversations_topic_id_desk_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."desk_topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desk_conversations" ADD CONSTRAINT "desk_conversations_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desk_messages" ADD CONSTRAINT "desk_messages_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desk_messages" ADD CONSTRAINT "desk_messages_conversation_id_desk_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."desk_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desk_topics" ADD CONSTRAINT "desk_topics_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "desk_channels_org_idx" ON "desk_channels" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "desk_channels_type_idx" ON "desk_channels" USING btree ("org_id","type");--> statement-breakpoint
CREATE INDEX "desk_contacts_org_idx" ON "desk_contacts" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "desk_contacts_email_idx" ON "desk_contacts" USING btree ("org_id","email");--> statement-breakpoint
CREATE INDEX "desk_contacts_end_user_idx" ON "desk_contacts" USING btree ("end_user_id");--> statement-breakpoint
CREATE INDEX "desk_conversations_org_idx" ON "desk_conversations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "desk_conversations_status_idx" ON "desk_conversations" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "desk_conversations_end_user_idx" ON "desk_conversations" USING btree ("end_user_id");--> statement-breakpoint
CREATE INDEX "desk_conversations_contact_idx" ON "desk_conversations" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "desk_conversations_display_uq" ON "desk_conversations" USING btree ("org_id","display_id");--> statement-breakpoint
CREATE INDEX "desk_conversations_last_msg_idx" ON "desk_conversations" USING btree ("org_id","last_message_at");--> statement-breakpoint
CREATE INDEX "desk_messages_conv_idx" ON "desk_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "desk_messages_org_idx" ON "desk_messages" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "desk_topics_org_idx" ON "desk_topics" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "desk_topics_org_slug_uq" ON "desk_topics" USING btree ("org_id","slug");