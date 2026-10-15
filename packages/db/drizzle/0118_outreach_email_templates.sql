-- Org-authored email templates for outreach. `mjml` is the template source,
-- compiled at send time; it wraps the message content at the {{content}}
-- placeholder and must carry {{unsubscribe_url}}. At most one template per org
-- is the default (partial unique index). The tenant_isolation policy lives in
-- outreach.sql and hides every row from end-user audiences.
CREATE TABLE IF NOT EXISTS "outreach_email_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"mjml" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by_actor_type" varchar(16) NOT NULL,
	"created_by_actor_id" text NOT NULL,
	"updated_by_actor_type" varchar(16),
	"updated_by_actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach_email_templates" ADD CONSTRAINT "outreach_email_templates_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_email_templates_org_idx" ON "outreach_email_templates" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "outreach_email_templates_org_name_uq" ON "outreach_email_templates" USING btree ("org_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "outreach_email_templates_org_default_uq" ON "outreach_email_templates" USING btree ("org_id") WHERE is_default = true;
