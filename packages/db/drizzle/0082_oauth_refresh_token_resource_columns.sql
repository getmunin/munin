-- The columns better-auth 1.7 persists on a refresh token.
--
-- 0080 carried the 1.7 resource-indicator model onto oauth_access_token,
-- oauth_client and oauth_consent but never touched oauth_refresh_token, which
-- gained the same set. The drizzle adapter validates every field it is asked
-- to write against the schema, so the provider's first insert dies with `The
-- field "authorizationCodeId" does not exist in the "oauthRefreshToken"
-- Drizzle schema` and the token endpoint answers 500 -- for the
-- authorization_code grant as much as refresh_token, since both mint a refresh
-- token. No token can be issued at all until these exist.
--
-- Every column is nullable, so rows written before this ran keep working and an
-- already-issued refresh token can still rotate.
ALTER TABLE "oauth_refresh_token" ADD COLUMN IF NOT EXISTS "authorization_code_id" text;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD COLUMN IF NOT EXISTS "resources" text[];--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD COLUMN IF NOT EXISTS "requested_user_info_claims" text[];--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD COLUMN IF NOT EXISTS "rotated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD COLUMN IF NOT EXISTS "rotation_replay_response" text;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD COLUMN IF NOT EXISTS "rotation_replay_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD COLUMN IF NOT EXISTS "confirmation" jsonb;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_refresh_token_authorization_code_idx" ON "oauth_refresh_token" USING btree ("authorization_code_id");
