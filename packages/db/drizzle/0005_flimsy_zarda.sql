CREATE TABLE "cms_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"storage_provider" varchar(16) NOT NULL,
	"storage_key" text NOT NULL,
	"public_url" text NOT NULL,
	"alt_text" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"uploaded" boolean DEFAULT false NOT NULL,
	"created_by_type" varchar(16) NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_collections" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" varchar(64) NOT NULL,
	"description" text,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"localized" boolean DEFAULT false NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"collection_id" text NOT NULL,
	"slug" varchar(200) NOT NULL,
	"locale" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"embedding" vector(1536),
	"scheduled_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_by_type" varchar(16) NOT NULL,
	"created_by_id" text NOT NULL,
	"updated_by_type" varchar(16) NOT NULL,
	"updated_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_entry_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"entry_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" varchar(16) NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_type" varchar(16) NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_locales" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"code" varchar(16) NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_references" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"from_entry_id" text NOT NULL,
	"to_entry_id" text NOT NULL,
	"field_name" varchar(64) NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cms_assets" ADD CONSTRAINT "cms_assets_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_collections" ADD CONSTRAINT "cms_collections_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_entries" ADD CONSTRAINT "cms_entries_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_entries" ADD CONSTRAINT "cms_entries_collection_id_cms_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."cms_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_entry_versions" ADD CONSTRAINT "cms_entry_versions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_entry_versions" ADD CONSTRAINT "cms_entry_versions_entry_id_cms_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."cms_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_locales" ADD CONSTRAINT "cms_locales_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_references" ADD CONSTRAINT "cms_references_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_references" ADD CONSTRAINT "cms_references_from_entry_id_cms_entries_id_fk" FOREIGN KEY ("from_entry_id") REFERENCES "public"."cms_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_references" ADD CONSTRAINT "cms_references_to_entry_id_cms_entries_id_fk" FOREIGN KEY ("to_entry_id") REFERENCES "public"."cms_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cms_assets_org_idx" ON "cms_assets" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_assets_key_uq" ON "cms_assets" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "cms_collections_org_idx" ON "cms_collections" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_collections_slug_uq" ON "cms_collections" USING btree ("org_id","slug");--> statement-breakpoint
CREATE INDEX "cms_entries_org_idx" ON "cms_entries" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "cms_entries_collection_idx" ON "cms_entries" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "cms_entries_status_idx" ON "cms_entries" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "cms_entries_delivery_idx" ON "cms_entries" USING btree ("org_id","collection_id","status","locale");--> statement-breakpoint
CREATE INDEX "cms_entries_scheduled_idx" ON "cms_entries" USING btree ("scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_entries_slug_uq" ON "cms_entries" USING btree ("org_id","collection_id","slug","locale");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_versions_entry_version_uq" ON "cms_entry_versions" USING btree ("entry_id","version");--> statement-breakpoint
CREATE INDEX "cms_versions_org_idx" ON "cms_entry_versions" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_locales_code_uq" ON "cms_locales" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "cms_references_from_idx" ON "cms_references" USING btree ("from_entry_id");--> statement-breakpoint
CREATE INDEX "cms_references_to_idx" ON "cms_references" USING btree ("to_entry_id");