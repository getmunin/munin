CREATE TABLE "kb_document_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"document_id" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"token_count" integer NOT NULL,
	"embedding" vector(1536),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_document_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"document_id" text NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"public" boolean NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_type" varchar(16) NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"space_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"public" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_type" varchar(16) NOT NULL,
	"created_by_id" text NOT NULL,
	"updated_by_type" varchar(16) NOT NULL,
	"updated_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_spaces" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" varchar(64) NOT NULL,
	"description" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kb_document_chunks" ADD CONSTRAINT "kb_document_chunks_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_document_chunks" ADD CONSTRAINT "kb_document_chunks_document_id_kb_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."kb_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_document_versions" ADD CONSTRAINT "kb_document_versions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_document_versions" ADD CONSTRAINT "kb_document_versions_document_id_kb_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."kb_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_documents" ADD CONSTRAINT "kb_documents_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_documents" ADD CONSTRAINT "kb_documents_space_id_kb_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."kb_spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_spaces" ADD CONSTRAINT "kb_spaces_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kb_chunks_document_idx" ON "kb_document_chunks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "kb_chunks_org_idx" ON "kb_document_chunks" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kb_chunks_doc_order_uq" ON "kb_document_chunks" USING btree ("document_id","chunk_index");--> statement-breakpoint
CREATE UNIQUE INDEX "kb_versions_doc_version_uq" ON "kb_document_versions" USING btree ("document_id","version");--> statement-breakpoint
CREATE INDEX "kb_versions_org_idx" ON "kb_document_versions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "kb_documents_org_idx" ON "kb_documents" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "kb_documents_space_idx" ON "kb_documents" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "kb_documents_public_idx" ON "kb_documents" USING btree ("org_id","public");--> statement-breakpoint
CREATE INDEX "kb_spaces_org_idx" ON "kb_spaces" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kb_spaces_org_slug_uq" ON "kb_spaces" USING btree ("org_id","slug");