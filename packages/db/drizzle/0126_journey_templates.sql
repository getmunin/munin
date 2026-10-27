-- Org-saved journey templates: a parameterised spec with {{param:key}}
-- placeholders, unique per (org, slug, locale). Built-in starter templates
-- ship in code. Tenant isolation policies live in journeys.sql.
CREATE TABLE IF NOT EXISTS "journey_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"slug" varchar(64) NOT NULL,
	"locale" varchar(10) NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"params" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"spec" jsonb NOT NULL,
	"created_by_actor_type" varchar(16) NOT NULL,
	"created_by_actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journey_templates" ADD CONSTRAINT "journey_templates_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "journey_templates_slug_uq" ON "journey_templates" USING btree ("org_id","slug","locale");
