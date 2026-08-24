CREATE TABLE IF NOT EXISTS "connector_signing_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"public_jwk" jsonb NOT NULL,
	"private_key_pem" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "connector_signing_keys" ADD CONSTRAINT "connector_signing_keys_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "connector_signing_keys_org_uq" ON "connector_signing_keys" USING btree ("org_id");