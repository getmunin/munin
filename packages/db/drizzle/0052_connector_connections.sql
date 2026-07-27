CREATE TABLE "connector_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"vendor" varchar(32) NOT NULL,
	"domain" varchar(32) NOT NULL,
	"name" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_tested_at" timestamp with time zone,
	"last_test_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connector_connections" ADD CONSTRAINT "connector_connections_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connector_connections_org_idx" ON "connector_connections" USING btree ("org_id","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "connector_connections_org_name_uq" ON "connector_connections" USING btree ("org_id","name");