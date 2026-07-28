ALTER TABLE "cms_assets" ADD COLUMN "width" integer;--> statement-breakpoint
ALTER TABLE "cms_assets" ADD COLUMN "height" integer;--> statement-breakpoint
ALTER TABLE "cms_assets" ADD COLUMN "variants" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_assets" ADD COLUMN "variants_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "cms_assets_variants_version_idx" ON "cms_assets" USING btree ("variants_version");