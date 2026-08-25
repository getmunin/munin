-- better-auth 1.7 binds issued tokens to explicit resource indicators
-- (GHSA-p2fr-6hmx-4528). That adds a resource registry, a client↔resource
-- grant table, a replay guard for JWT client assertions, and the columns the
-- provider now persists on clients, access tokens and consents.
--
-- Every addition is nullable or defaulted, so existing rows need no backfill:
-- a client with no `application_type` keeps behaving as an OIDC `web` client,
-- and a token with no `resources` stays unscoped to any audience.
CREATE TABLE IF NOT EXISTS "oauth_client_assertion" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_resource" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"name" text NOT NULL,
	"access_token_ttl" integer,
	"refresh_token_ttl" integer,
	"signing_algorithm" text,
	"signing_key_id" text,
	"allowed_scopes" text[],
	"custom_claims" jsonb,
	"dpop_bound_access_tokens_required" boolean DEFAULT false,
	"disabled" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"policy_version" integer DEFAULT 1,
	"metadata" jsonb,
	CONSTRAINT "oauth_resource_identifier_unique" UNIQUE("identifier")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_client_resource" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_client_resource_client_id_oauth_client_client_id_fk"
		FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE cascade,
	CONSTRAINT "oauth_client_resource_resource_id_oauth_resource_identifier_fk"
		FOREIGN KEY ("resource_id") REFERENCES "public"."oauth_resource"("identifier") ON DELETE cascade
);--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD COLUMN IF NOT EXISTS "authorization_code_id" text;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD COLUMN IF NOT EXISTS "resources" text[];--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD COLUMN IF NOT EXISTS "requested_user_info_claims" text[];--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD COLUMN IF NOT EXISTS "revoked" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD COLUMN IF NOT EXISTS "confirmation" jsonb;--> statement-breakpoint
ALTER TABLE "oauth_client" ADD COLUMN IF NOT EXISTS "client_discovery_id" text;--> statement-breakpoint
ALTER TABLE "oauth_client" ADD COLUMN IF NOT EXISTS "client_credentials_scopes" text[] DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "oauth_client" ADD COLUMN IF NOT EXISTS "backchannel_logout_uri" text;--> statement-breakpoint
ALTER TABLE "oauth_client" ADD COLUMN IF NOT EXISTS "backchannel_logout_session_required" boolean;--> statement-breakpoint
ALTER TABLE "oauth_client" ADD COLUMN IF NOT EXISTS "application_type" text;--> statement-breakpoint
ALTER TABLE "oauth_client" ADD COLUMN IF NOT EXISTS "jwks" text;--> statement-breakpoint
ALTER TABLE "oauth_client" ADD COLUMN IF NOT EXISTS "jwks_uri" text;--> statement-breakpoint
ALTER TABLE "oauth_client" ADD COLUMN IF NOT EXISTS "dpop_bound_access_tokens" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD COLUMN IF NOT EXISTS "resources" text[];--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD COLUMN IF NOT EXISTS "requested_user_info_claims" text[];--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_client_resource_client_idx" ON "oauth_client_resource" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_client_resource_resource_idx" ON "oauth_client_resource" USING btree ("resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "oauth_client_resource_client_resource_uq" ON "oauth_client_resource" USING btree ("client_id","resource_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_access_token_authorization_code_idx" ON "oauth_access_token" USING btree ("authorization_code_id");
