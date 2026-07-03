CREATE TABLE "slack_channel_routes" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"integration_id" text NOT NULL,
	"team_id" text NOT NULL,
	"slack_channel_id" text NOT NULL,
	"slack_channel_name" text,
	"purpose" varchar(16) DEFAULT 'default' NOT NULL,
	"mention" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_conversation_links" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"integration_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"slack_channel_id" text NOT NULL,
	"slack_thread_ts" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"integration_id" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"conversation_id" text,
	"attempt" integer DEFAULT 0 NOT NULL,
	"error" text,
	"delivered_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_integrations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"team_id" text NOT NULL,
	"team_name" text,
	"encrypted_bot_token" text NOT NULL,
	"bot_user_id" text,
	"app_id" text,
	"installed_by_user_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_message_links" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"message_id" text NOT NULL,
	"slack_channel_id" text NOT NULL,
	"slack_ts" text NOT NULL,
	"origin" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_user_links" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"integration_id" text NOT NULL,
	"slack_user_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "slack_channel_routes" ADD CONSTRAINT "slack_channel_routes_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_channel_routes" ADD CONSTRAINT "slack_channel_routes_integration_id_slack_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."slack_integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_conversation_links" ADD CONSTRAINT "slack_conversation_links_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_conversation_links" ADD CONSTRAINT "slack_conversation_links_integration_id_slack_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."slack_integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_conversation_links" ADD CONSTRAINT "slack_conversation_links_conversation_id_conv_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conv_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_deliveries" ADD CONSTRAINT "slack_deliveries_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_deliveries" ADD CONSTRAINT "slack_deliveries_integration_id_slack_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."slack_integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_deliveries" ADD CONSTRAINT "slack_deliveries_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_deliveries" ADD CONSTRAINT "slack_deliveries_conversation_id_conv_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conv_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_integrations" ADD CONSTRAINT "slack_integrations_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_integrations" ADD CONSTRAINT "slack_integrations_installed_by_user_id_users_id_fk" FOREIGN KEY ("installed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_message_links" ADD CONSTRAINT "slack_message_links_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_message_links" ADD CONSTRAINT "slack_message_links_conversation_id_conv_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conv_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_message_links" ADD CONSTRAINT "slack_message_links_message_id_conv_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."conv_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_user_links" ADD CONSTRAINT "slack_user_links_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_user_links" ADD CONSTRAINT "slack_user_links_integration_id_slack_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."slack_integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_user_links" ADD CONSTRAINT "slack_user_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "slack_channel_routes_team_channel_uq" ON "slack_channel_routes" USING btree ("team_id","slack_channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_channel_routes_purpose_uq" ON "slack_channel_routes" USING btree ("integration_id","purpose");--> statement-breakpoint
CREATE INDEX "slack_channel_routes_org_idx" ON "slack_channel_routes" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_conversation_links_conversation_uq" ON "slack_conversation_links" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_conversation_links_thread_uq" ON "slack_conversation_links" USING btree ("slack_channel_id","slack_thread_ts");--> statement-breakpoint
CREATE INDEX "slack_conversation_links_org_idx" ON "slack_conversation_links" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "slack_deliveries_pending_idx" ON "slack_deliveries" USING btree ("next_attempt_at");--> statement-breakpoint
CREATE INDEX "slack_deliveries_conv_idx" ON "slack_deliveries" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "slack_deliveries_org_idx" ON "slack_deliveries" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_integrations_org_uq" ON "slack_integrations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "slack_integrations_team_idx" ON "slack_integrations" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_message_links_message_uq" ON "slack_message_links" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_message_links_ts_uq" ON "slack_message_links" USING btree ("slack_channel_id","slack_ts");--> statement-breakpoint
CREATE INDEX "slack_message_links_org_idx" ON "slack_message_links" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_user_links_slack_user_uq" ON "slack_user_links" USING btree ("integration_id","slack_user_id");--> statement-breakpoint
CREATE INDEX "slack_user_links_org_idx" ON "slack_user_links" USING btree ("org_id");