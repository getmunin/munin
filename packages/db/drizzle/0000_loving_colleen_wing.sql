CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" text,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rate_limit_per_min" integer,
	"rate_limit_per_day" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"partner_id" text,
	"type" varchar(32) NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" varchar(16) NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"actor_type" varchar(32) NOT NULL,
	"actor_id" text,
	"tool" text,
	"method" text,
	"target" jsonb,
	"args" jsonb,
	"correlation_id" text,
	"result" varchar(16),
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bootstrap_state" (
	"org_id" text NOT NULL,
	"app_key" varchar(32) NOT NULL,
	"completed_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bootstrap_state_org_id_app_key_pk" PRIMARY KEY("org_id","app_key")
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "end_users" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"external_id" text,
	"email" text,
	"phone" text,
	"name" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"type" text NOT NULL,
	"actor_id" text,
	"correlation_id" text,
	"hop_count" integer DEFAULT 0 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"client_id" text NOT NULL,
	"client_secret_hash" text,
	"name" text NOT NULL,
	"redirect_uris" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"grant_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_clients_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "org_members" (
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" varchar(32) DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_members_org_id_user_id_pk" PRIMARY KEY("org_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" varchar(64) NOT NULL,
	"partner_id" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orgs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" varchar(64) NOT NULL,
	"partner_key_hash" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"consent_url_template" text,
	"branding_metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partners_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "rate_limit_counters" (
	"org_id" text NOT NULL,
	"bucket" varchar(64) NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limit_counters_org_id_bucket_window_start_pk" PRIMARY KEY("org_id","bucket","window_start")
);
--> statement-breakpoint
CREATE TABLE "suggestions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"app_scope" varchar(32),
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"created_by_type" varchar(16) NOT NULL,
	"created_by_id" text NOT NULL,
	"vote_count" integer DEFAULT 0 NOT NULL,
	"public" boolean DEFAULT false NOT NULL,
	"duplicate_of_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"type" varchar(32) NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"audiences" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"user_id" text,
	"agent_id" text,
	"oauth_client_id" text,
	"end_user_id" text,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"name" text,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"suggestion_id" text NOT NULL,
	"voter_type" varchar(16) NOT NULL,
	"voter_id" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "votes_suggestion_id_voter_type_voter_id_pk" PRIMARY KEY("suggestion_id","voter_type","voter_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"webhook_id" text NOT NULL,
	"event_id" text NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"status_code" integer,
	"duration_ms" integer,
	"error" text,
	"delivered_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bootstrap_state" ADD CONSTRAINT "bootstrap_state_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "end_users" ADD CONSTRAINT "end_users_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_clients" ADD CONSTRAINT "oauth_clients_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_limit_counters" ADD CONSTRAINT "rate_limit_counters_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_oauth_client_id_oauth_clients_id_fk" FOREIGN KEY ("oauth_client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_end_user_id_end_users_id_fk" FOREIGN KEY ("end_user_id") REFERENCES "public"."end_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_suggestion_id_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."suggestions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_org_idx" ON "agents" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "api_keys_org_idx" ON "api_keys" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "api_keys_partner_idx" ON "api_keys" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "api_keys_prefix_idx" ON "api_keys" USING btree ("key_prefix");--> statement-breakpoint
CREATE INDEX "audit_log_org_idx" ON "audit_log" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_correlation_idx" ON "audit_log" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_type","actor_id");--> statement-breakpoint
CREATE INDEX "claims_entity_idx" ON "claims" USING btree ("org_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "claims_expires_idx" ON "claims" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "end_users_org_idx" ON "end_users" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "end_users_org_external_uq" ON "end_users" USING btree ("org_id","external_id");--> statement-breakpoint
CREATE INDEX "end_users_email_idx" ON "end_users" USING btree ("org_id","email");--> statement-breakpoint
CREATE INDEX "end_users_phone_idx" ON "end_users" USING btree ("org_id","phone");--> statement-breakpoint
CREATE INDEX "events_org_idx" ON "events" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "events_type_idx" ON "events" USING btree ("type");--> statement-breakpoint
CREATE INDEX "events_correlation_idx" ON "events" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "oauth_clients_org_idx" ON "oauth_clients" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "org_members_user_idx" ON "org_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "orgs_partner_idx" ON "orgs" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "suggestions_org_idx" ON "suggestions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "suggestions_status_idx" ON "suggestions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "suggestions_public_idx" ON "suggestions" USING btree ("public","vote_count");--> statement-breakpoint
CREATE INDEX "tokens_org_idx" ON "tokens" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "tokens_type_idx" ON "tokens" USING btree ("type");--> statement-breakpoint
CREATE INDEX "tokens_end_user_idx" ON "tokens" USING btree ("end_user_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_webhook_idx" ON "webhook_deliveries" USING btree ("webhook_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_pending_idx" ON "webhook_deliveries" USING btree ("next_attempt_at");--> statement-breakpoint
CREATE INDEX "webhooks_org_idx" ON "webhooks" USING btree ("org_id");