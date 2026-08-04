CREATE TABLE IF NOT EXISTS "kb_curation_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"source_conversation_id" text,
	"candidate_document_id" text NOT NULL,
	"title" text NOT NULL,
	"outcome" varchar(16) NOT NULL,
	"reason" text,
	"published_document_id" text,
	"decided_by_actor_type" varchar(16) NOT NULL,
	"decided_by_actor_id" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "kb_curation_decisions" ADD CONSTRAINT "kb_curation_decisions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "kb_curation_decisions" ADD CONSTRAINT "kb_curation_decisions_published_document_id_kb_documents_id_fk" FOREIGN KEY ("published_document_id") REFERENCES "public"."kb_documents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_curation_decisions_org_source_idx" ON "kb_curation_decisions" USING btree ("org_id","source_conversation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_curation_decisions_org_outcome_idx" ON "kb_curation_decisions" USING btree ("org_id","outcome");
