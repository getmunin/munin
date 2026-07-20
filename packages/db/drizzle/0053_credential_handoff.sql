CREATE TABLE "credential_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"target_type" varchar(32) NOT NULL,
	"target_id" text NOT NULL,
	"link_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connector_connections" ADD COLUMN "credential_state" varchar(16) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "credential_requests" ADD CONSTRAINT "credential_requests_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credential_requests_link_idx" ON "credential_requests" USING btree ("link_hash");--> statement-breakpoint
CREATE INDEX "credential_requests_target_idx" ON "credential_requests" USING btree ("target_type","target_id");