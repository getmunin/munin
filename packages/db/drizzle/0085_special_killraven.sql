CREATE TABLE "conv_sending_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"domain" text NOT NULL,
	"selector" text NOT NULL,
	"private_key_pem" text NOT NULL,
	"public_key_pem" text NOT NULL,
	"provider" varchar(32) DEFAULT 'dns' NOT NULL,
	"provider_ref" text,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"last_error" text,
	"verified_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conv_sending_identities" ADD CONSTRAINT "conv_sending_identities_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conv_sending_identities_org_idx" ON "conv_sending_identities" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conv_sending_identities_org_domain_uq" ON "conv_sending_identities" USING btree ("org_id","domain");--> statement-breakpoint
CREATE INDEX "conv_sending_identities_status_idx" ON "conv_sending_identities" USING btree ("status");