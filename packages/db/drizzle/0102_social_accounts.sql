-- LinkedIn member grants, and the per-org OAuth client they are minted with.
--
-- Two tables because they have different lifetimes and different blast radii.
-- social_platform_apps is org-level configuration an owner enters once: a
-- self-hoster cannot use Munin's OAuth client, so client id and secret are
-- per-org rows rather than deployment env vars — the same reasoning that put
-- them on connector connections.
--
-- social_accounts is one row per person per platform. encrypted_refresh_token
-- is NULLABLE and that is the whole point: LinkedIn only issues refresh tokens
-- to approved Marketing Developer Platform partners, so a self-serve "Share on
-- LinkedIn" app gets a 60-day access token and nothing to renew it with. A
-- schema that required a refresh token would be unimplementable against the
-- tier most orgs are on. Rows that do carry one refresh silently; rows that do
-- not raise a user-scoped alert and ask the person to reconnect.
--
-- status is 'active' from birth — unlike a connector connection there is no
-- 'pending' state, because the row is only written once the grant has landed.
--
-- Written idempotently so a corrected journal timestamp can re-run it.

CREATE TABLE IF NOT EXISTS "social_platform_apps" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"platform" varchar(16) NOT NULL,
	"client_id" text NOT NULL,
	"encrypted_client_secret" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "social_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"platform" varchar(16) NOT NULL,
	"author_kind" varchar(16) DEFAULT 'member' NOT NULL,
	"external_account_id" text NOT NULL,
	"display_name" text,
	"encrypted_access_token" text NOT NULL,
	"access_token_expires_at" timestamp with time zone,
	"encrypted_refresh_token" text,
	"refresh_token_expires_at" timestamp with time zone,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"last_error" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_platform_apps_org_id_orgs_id_fk') THEN
    ALTER TABLE "social_platform_apps" ADD CONSTRAINT "social_platform_apps_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_accounts_org_id_orgs_id_fk') THEN
    ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_accounts_user_id_users_id_fk') THEN
    ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "social_platform_apps_org_platform_uq" ON "social_platform_apps" USING btree ("org_id","platform");--> statement-breakpoint

-- One account per person per platform, and one platform account claimed once
-- per org: without the second index two Munin users could both attach the same
-- LinkedIn profile and each believe they were posting as themselves.
CREATE UNIQUE INDEX IF NOT EXISTS "social_accounts_org_user_platform_uq" ON "social_accounts" USING btree ("org_id","user_id","platform");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "social_accounts_org_platform_external_uq" ON "social_accounts" USING btree ("org_id","platform","external_account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_accounts_org_status_idx" ON "social_accounts" USING btree ("org_id","platform","status");--> statement-breakpoint

-- The expiry sweep reads (status, access_token_expires_at) across every org, so
-- this index is deliberately not org-leading.
CREATE INDEX IF NOT EXISTS "social_accounts_expiry_idx" ON "social_accounts" USING btree ("status","access_token_expires_at");--> statement-breakpoint

-- Enum-shaped columns are guarded here rather than in schema.ts, matching
-- org_alerts and social_post_drafts. Drizzle cannot see these, so adding a
-- platform or a status in TypeScript means editing a migration too.
ALTER TABLE "social_platform_apps" DROP CONSTRAINT IF EXISTS "social_platform_apps_platform_chk";--> statement-breakpoint
ALTER TABLE "social_platform_apps" ADD CONSTRAINT "social_platform_apps_platform_chk"
    CHECK ("platform" IN ('linkedin'));--> statement-breakpoint
ALTER TABLE "social_accounts" DROP CONSTRAINT IF EXISTS "social_accounts_platform_chk";--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_platform_chk"
    CHECK ("platform" IN ('linkedin'));--> statement-breakpoint
ALTER TABLE "social_accounts" DROP CONSTRAINT IF EXISTS "social_accounts_author_kind_chk";--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_author_kind_chk"
    CHECK ("author_kind" IN ('member', 'org_page'));--> statement-breakpoint
ALTER TABLE "social_accounts" DROP CONSTRAINT IF EXISTS "social_accounts_status_chk";--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_status_chk"
    CHECK ("status" IN ('active', 'expired', 'revoked'));
