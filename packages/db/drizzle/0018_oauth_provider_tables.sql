DROP TABLE IF EXISTS "oauth_consents" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "oauth_access_tokens" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "oauth_applications" CASCADE;
--> statement-breakpoint
CREATE TABLE "oauth_client" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL UNIQUE,
  "client_secret" text,
  "disabled" boolean NOT NULL DEFAULT false,
  "skip_consent" boolean,
  "enable_end_session" boolean,
  "subject_type" text,
  "scopes" text[],
  "user_id" text,
  "name" text,
  "uri" text,
  "icon" text,
  "contacts" text[],
  "tos" text,
  "policy" text,
  "software_id" text,
  "software_version" text,
  "software_statement" text,
  "redirect_uris" text[] NOT NULL,
  "post_logout_redirect_uris" text[],
  "token_endpoint_auth_method" text,
  "grant_types" text[],
  "response_types" text[],
  "public" boolean,
  "type" text,
  "require_pkce" boolean,
  "reference_id" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "oauth_client"
  ADD CONSTRAINT "oauth_client_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "oauth_client_user_idx" ON "oauth_client" ("user_id");
--> statement-breakpoint
CREATE TABLE "oauth_refresh_token" (
  "id" text PRIMARY KEY NOT NULL,
  "token" text NOT NULL,
  "client_id" text NOT NULL,
  "session_id" text,
  "user_id" text NOT NULL,
  "reference_id" text,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "revoked" timestamp with time zone,
  "auth_time" timestamp with time zone,
  "scopes" text[] NOT NULL
);
--> statement-breakpoint
ALTER TABLE "oauth_refresh_token"
  ADD CONSTRAINT "oauth_refresh_token_client_id_oauth_client_client_id_fk"
  FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "oauth_refresh_token"
  ADD CONSTRAINT "oauth_refresh_token_session_id_sessions_id_fk"
  FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "oauth_refresh_token"
  ADD CONSTRAINT "oauth_refresh_token_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_client_idx" ON "oauth_refresh_token" ("client_id");
--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_session_idx" ON "oauth_refresh_token" ("session_id");
--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_user_idx" ON "oauth_refresh_token" ("user_id");
--> statement-breakpoint
CREATE TABLE "oauth_access_token" (
  "id" text PRIMARY KEY NOT NULL,
  "token" text NOT NULL UNIQUE,
  "client_id" text NOT NULL,
  "session_id" text,
  "user_id" text,
  "reference_id" text,
  "refresh_id" text,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "scopes" text[] NOT NULL
);
--> statement-breakpoint
ALTER TABLE "oauth_access_token"
  ADD CONSTRAINT "oauth_access_token_client_id_oauth_client_client_id_fk"
  FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "oauth_access_token"
  ADD CONSTRAINT "oauth_access_token_session_id_sessions_id_fk"
  FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "oauth_access_token"
  ADD CONSTRAINT "oauth_access_token_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "oauth_access_token"
  ADD CONSTRAINT "oauth_access_token_refresh_id_oauth_refresh_token_id_fk"
  FOREIGN KEY ("refresh_id") REFERENCES "public"."oauth_refresh_token"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "oauth_access_token_client_idx" ON "oauth_access_token" ("client_id");
--> statement-breakpoint
CREATE INDEX "oauth_access_token_session_idx" ON "oauth_access_token" ("session_id");
--> statement-breakpoint
CREATE INDEX "oauth_access_token_user_idx" ON "oauth_access_token" ("user_id");
--> statement-breakpoint
CREATE INDEX "oauth_access_token_refresh_idx" ON "oauth_access_token" ("refresh_id");
--> statement-breakpoint
CREATE TABLE "oauth_consent" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL,
  "user_id" text,
  "reference_id" text,
  "scopes" text[] NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "oauth_consent"
  ADD CONSTRAINT "oauth_consent_client_id_oauth_client_client_id_fk"
  FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "oauth_consent"
  ADD CONSTRAINT "oauth_consent_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "oauth_consent_client_user_idx" ON "oauth_consent" ("client_id", "user_id");
--> statement-breakpoint
CREATE TABLE "jwks" (
  "id" text PRIMARY KEY NOT NULL,
  "public_key" text NOT NULL,
  "private_key" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at" timestamp with time zone
);
