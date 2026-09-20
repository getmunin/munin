-- Facebook Page publishing: a second social platform that posts as a company
-- Page rather than as a person.
--
-- Three changes, each for a different reason.
--
-- 1. social_pending_grants. LinkedIn's authorization resolves to exactly one
--    author, so the callback can write the account row immediately. A Facebook
--    grant does not: it yields a long-lived *user* token, and that token is
--    only a key to a list of Pages the person administers. Which Page to post
--    as is a human decision, so the callback parks the user token here and the
--    dashboard asks. The Page access token is fetched live when the choice is
--    made, which is why no page credential is ever stored on this table --
--    only the owner token needed to enumerate and derive one. Rows are short
--    lived (minutes) and deleted the moment a Page is chosen.
--
-- 2. Every platform check constraint learns 'facebook' -- on the drafts table
--    as well as the two account tables, since a draft is written before any
--    of this can be published. Drizzle cannot see these, so a new platform in
--    TypeScript always means editing a migration.
--
-- 3. social_accounts_org_platform_external_uq becomes partial. It exists so two
--    colleagues cannot both attach the same LinkedIn profile and each believe
--    they are posting as themselves -- which is right for a personal profile
--    and wrong for a company Page, where several admins posting as the Page is
--    the normal arrangement. Restricting it to author_kind = 'member' keeps the
--    guarantee where it means something.
--
-- Written idempotently so a corrected journal timestamp can re-run it.

CREATE TABLE IF NOT EXISTS "social_pending_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"platform" varchar(16) NOT NULL,
	"encrypted_owner_token" text NOT NULL,
	"owner_token_expires_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_pending_grants_org_id_orgs_id_fk') THEN
    ALTER TABLE "social_pending_grants" ADD CONSTRAINT "social_pending_grants_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_pending_grants_user_id_users_id_fk') THEN
    ALTER TABLE "social_pending_grants" ADD CONSTRAINT "social_pending_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

-- One authorization in flight per person per platform: starting the flow again
-- replaces the parked token rather than accumulating dead ones.
CREATE UNIQUE INDEX IF NOT EXISTS "social_pending_grants_org_user_platform_uq" ON "social_pending_grants" USING btree ("org_id","user_id","platform");--> statement-breakpoint

-- The sweep for abandoned flows reads expires_at across every org, so this
-- index is deliberately not org-leading.
CREATE INDEX IF NOT EXISTS "social_pending_grants_expires_idx" ON "social_pending_grants" USING btree ("expires_at");--> statement-breakpoint

ALTER TABLE "social_pending_grants" DROP CONSTRAINT IF EXISTS "social_pending_grants_platform_chk";--> statement-breakpoint
ALTER TABLE "social_pending_grants" ADD CONSTRAINT "social_pending_grants_platform_chk"
    CHECK ("platform" IN ('linkedin', 'facebook'));--> statement-breakpoint

ALTER TABLE "social_platform_apps" DROP CONSTRAINT IF EXISTS "social_platform_apps_platform_chk";--> statement-breakpoint
ALTER TABLE "social_platform_apps" ADD CONSTRAINT "social_platform_apps_platform_chk"
    CHECK ("platform" IN ('linkedin', 'facebook'));--> statement-breakpoint
ALTER TABLE "social_accounts" DROP CONSTRAINT IF EXISTS "social_accounts_platform_chk";--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_platform_chk"
    CHECK ("platform" IN ('linkedin', 'facebook'));--> statement-breakpoint
ALTER TABLE "social_post_drafts" DROP CONSTRAINT IF EXISTS "social_post_drafts_platform_chk";--> statement-breakpoint
ALTER TABLE "social_post_drafts" ADD CONSTRAINT "social_post_drafts_platform_chk"
    CHECK ("platform" IN ('linkedin', 'facebook'));--> statement-breakpoint

DROP INDEX IF EXISTS "social_accounts_org_platform_external_uq";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "social_accounts_org_platform_external_uq" ON "social_accounts" USING btree ("org_id","platform","external_account_id") WHERE "author_kind" = 'member';
