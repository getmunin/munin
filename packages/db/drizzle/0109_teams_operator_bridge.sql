-- Microsoft Teams operator bridge: the Teams counterpart of the Slack bridge
-- (0050). Each conversation mirrors into one Teams channel thread; operators
-- reply from the thread and take over / close from the root card.
--
-- The big difference from Slack is where the app lives. Slack has one
-- deployment-level app (env vars) installed per workspace over OAuth. Azure
-- stopped creating multi-tenant bots after 2025-07-31, so a single shared bot
-- cannot serve every customer tenant without Teams Store publication. Each org
-- therefore registers its own single-tenant bot and Munin stores the bot's app
-- id, Entra tenant and client secret (pgcrypto-encrypted) on
-- teams_integrations. app_id is globally unique: inbound activities carry the
-- bot's app id as the JWT audience, and that is how the org is resolved.
--
-- teams_installed_teams records the teams the bot was added to, learned from
-- conversationUpdate / installationUpdate activities, including the regional
-- Bot Connector service_url outbound calls must go to. There is no Slack
-- equivalent because Slack has a single global API host.
--
-- Everything else mirrors the Slack tables: routes, conversation/thread links
-- (root activity id instead of thread_ts), message links for loop prevention,
-- Entra-object-id -> member links, and a durable delivery queue with the same
-- head-of-line ordering key.
--
-- Written idempotently so a corrected journal timestamp can re-run it.

CREATE TABLE IF NOT EXISTS "teams_integrations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"app_id" text NOT NULL,
	"bot_tenant_id" text NOT NULL,
	"encrypted_app_secret" text,
	"installed_by_user_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_integrations_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "teams_integrations_installed_by_user_id_users_id_fk" FOREIGN KEY ("installed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "teams_installed_teams" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"integration_id" text NOT NULL,
	"team_id" text NOT NULL,
	"team_name" text,
	"tenant_id" text NOT NULL,
	"service_url" text NOT NULL,
	"installed" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_installed_teams_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "teams_installed_teams_integration_id_teams_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."teams_integrations"("id") ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "teams_channel_routes" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"integration_id" text NOT NULL,
	"installed_team_id" text NOT NULL,
	"teams_channel_id" text NOT NULL,
	"teams_channel_name" text,
	"purpose" varchar(16) DEFAULT 'default' NOT NULL,
	"conv_channel_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_channel_routes_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "teams_channel_routes_integration_id_teams_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."teams_integrations"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "teams_channel_routes_installed_team_id_teams_installed_teams_id_fk" FOREIGN KEY ("installed_team_id") REFERENCES "public"."teams_installed_teams"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "teams_channel_routes_conv_channel_id_conv_channels_id_fk" FOREIGN KEY ("conv_channel_id") REFERENCES "public"."conv_channels"("id") ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "teams_conversation_links" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"integration_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"teams_channel_id" text NOT NULL,
	"root_activity_id" text NOT NULL,
	"service_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_conversation_links_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "teams_conversation_links_integration_id_teams_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."teams_integrations"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "teams_conversation_links_conversation_id_conv_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conv_conversations"("id") ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "teams_message_links" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"message_id" text NOT NULL,
	"teams_channel_id" text NOT NULL,
	"activity_id" text NOT NULL,
	"origin" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_message_links_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "teams_message_links_conversation_id_conv_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conv_conversations"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "teams_message_links_message_id_conv_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."conv_messages"("id") ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "teams_user_links" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"integration_id" text NOT NULL,
	"aad_object_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_user_links_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "teams_user_links_integration_id_teams_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."teams_integrations"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "teams_user_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "teams_deliveries" (
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
	"order_at" timestamp with time zone DEFAULT now() NOT NULL,
	"order_seq" integer DEFAULT -1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_deliveries_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "teams_deliveries_integration_id_teams_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."teams_integrations"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "teams_deliveries_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "teams_deliveries_conversation_id_conv_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conv_conversations"("id") ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "teams_integrations_org_uq" ON "teams_integrations" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "teams_integrations_app_uq" ON "teams_integrations" USING btree ("app_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "teams_installed_teams_team_uq" ON "teams_installed_teams" USING btree ("integration_id","team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teams_installed_teams_org_idx" ON "teams_installed_teams" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "teams_channel_routes_channel_uq" ON "teams_channel_routes" USING btree ("integration_id","teams_channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "teams_channel_routes_purpose_uq" ON "teams_channel_routes" USING btree ("integration_id","purpose") WHERE conv_channel_id IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "teams_channel_routes_conv_channel_uq" ON "teams_channel_routes" USING btree ("integration_id","conv_channel_id") WHERE conv_channel_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teams_channel_routes_org_idx" ON "teams_channel_routes" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "teams_conversation_links_conversation_uq" ON "teams_conversation_links" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "teams_conversation_links_thread_uq" ON "teams_conversation_links" USING btree ("teams_channel_id","root_activity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teams_conversation_links_org_idx" ON "teams_conversation_links" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "teams_message_links_message_uq" ON "teams_message_links" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "teams_message_links_activity_uq" ON "teams_message_links" USING btree ("teams_channel_id","activity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teams_message_links_org_idx" ON "teams_message_links" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "teams_user_links_aad_user_uq" ON "teams_user_links" USING btree ("integration_id","aad_object_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teams_user_links_org_idx" ON "teams_user_links" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teams_deliveries_pending_idx" ON "teams_deliveries" USING btree ("next_attempt_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teams_deliveries_conv_idx" ON "teams_deliveries" USING btree ("conversation_id","order_at","order_seq","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teams_deliveries_org_idx" ON "teams_deliveries" USING btree ("org_id");
