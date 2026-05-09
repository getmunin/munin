-- OAuth 2.1 / OIDC provider tables (Better-Auth oidcProvider plugin).
-- Separate from the legacy `oauth_clients` table so Better-Auth runs
-- unmodified; the plugin schema mapping points at these.

CREATE TABLE "oauth_applications" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL UNIQUE,
  "client_secret" text,
  "type" text NOT NULL,
  "name" text NOT NULL,
  "icon" text,
  "metadata" text,
  "disabled" boolean DEFAULT false NOT NULL,
  "redirect_urls" text NOT NULL,
  "user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "oauth_applications"
  ADD CONSTRAINT "oauth_applications_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX "oauth_applications_user_idx" ON "oauth_applications" ("user_id");
--> statement-breakpoint

CREATE TABLE "oauth_access_tokens" (
  "id" text PRIMARY KEY NOT NULL,
  "access_token" text NOT NULL UNIQUE,
  "refresh_token" text NOT NULL UNIQUE,
  "access_token_expires_at" timestamp with time zone NOT NULL,
  "refresh_token_expires_at" timestamp with time zone NOT NULL,
  "client_id" text NOT NULL,
  "user_id" text,
  "scopes" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "oauth_access_tokens"
  ADD CONSTRAINT "oauth_access_tokens_client_id_oauth_applications_client_id_fk"
  FOREIGN KEY ("client_id") REFERENCES "public"."oauth_applications"("client_id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "oauth_access_tokens"
  ADD CONSTRAINT "oauth_access_tokens_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX "oauth_access_tokens_client_idx" ON "oauth_access_tokens" ("client_id");
--> statement-breakpoint

CREATE INDEX "oauth_access_tokens_user_idx" ON "oauth_access_tokens" ("user_id");
--> statement-breakpoint

CREATE TABLE "oauth_consents" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL,
  "user_id" text NOT NULL,
  "scopes" text NOT NULL,
  "consent_given" boolean NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "oauth_consents"
  ADD CONSTRAINT "oauth_consents_client_id_oauth_applications_client_id_fk"
  FOREIGN KEY ("client_id") REFERENCES "public"."oauth_applications"("client_id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "oauth_consents"
  ADD CONSTRAINT "oauth_consents_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX "oauth_consents_client_user_idx" ON "oauth_consents" ("client_id", "user_id");
