-- Span store for pseudonymizing personal data on the external MCP surface.
--
-- Detection is split in two. National IDs, emails, phones, bank accounts and every
-- name the org already holds (CRM contacts, conversation contacts, end users) are
-- deterministic and cheap, so they are matched when a result is read and need no
-- storage. Names the org has never seen — third parties mentioned in free text —
-- need a NER model, which runs out of process in the annotation worker. These two
-- tables hold what that worker found.
--
-- pii_message_annotations: one row per message the worker has claimed. A NULL
-- ner_version means claimed but never completed. The worker claims rows whose
-- ner_version is NULL or lower than its own detector version, so a model upgrade
-- re-annotates history on its own and a stale worker can never overwrite newer
-- results. lease_holder / lease_expires_at give FOR UPDATE SKIP LOCKED claims the
-- same shape as curator_jobs.
--
-- pii_spans: each detected name, with its surface text. The surface is what the read
-- path matches on, so a name found in one message is masked wherever it appears in a
-- result — including snippets and subjects that are not the annotated body. Offsets
-- are kept for audit: they let a DPO see exactly what was detected, and where.
--
-- Both tables cascade from conv_messages, so erasing a message erases what was
-- learned from it.
--
-- Written idempotently so a corrected journal timestamp can re-run it.

CREATE TABLE IF NOT EXISTS "pii_message_annotations" (
	"message_id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"ner_version" integer,
	"ner_detector" text,
	"annotated_at" timestamp with time zone,
	"lease_holder" text,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pii_spans" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"message_id" text NOT NULL,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL,
	"kind" varchar(16) NOT NULL,
	"surface" text NOT NULL,
	"source" varchar(32) NOT NULL,
	"detector_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pii_message_annotations_message_id_conv_messages_id_fk') THEN
    ALTER TABLE "pii_message_annotations" ADD CONSTRAINT "pii_message_annotations_message_id_conv_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."conv_messages"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pii_message_annotations_org_id_orgs_id_fk') THEN
    ALTER TABLE "pii_message_annotations" ADD CONSTRAINT "pii_message_annotations_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pii_spans_org_id_orgs_id_fk') THEN
    ALTER TABLE "pii_spans" ADD CONSTRAINT "pii_spans_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pii_spans_message_id_conv_messages_id_fk') THEN
    ALTER TABLE "pii_spans" ADD CONSTRAINT "pii_spans_message_id_conv_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."conv_messages"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pii_message_annotations_org_version_idx" ON "pii_message_annotations" USING btree ("org_id","ner_version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pii_spans_org_kind_idx" ON "pii_spans" USING btree ("org_id","kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pii_spans_message_idx" ON "pii_spans" USING btree ("message_id");--> statement-breakpoint

-- PER only for now: addresses (LOC / GPE_LOC) carry less identifying value and a much
-- higher false-positive rate. Widening this is a deliberate decision, not a default.
ALTER TABLE "pii_spans" DROP CONSTRAINT IF EXISTS "pii_spans_kind_chk";--> statement-breakpoint
ALTER TABLE "pii_spans" ADD CONSTRAINT "pii_spans_kind_chk" CHECK ("kind" IN ('person'));--> statement-breakpoint
ALTER TABLE "pii_spans" DROP CONSTRAINT IF EXISTS "pii_spans_offsets_chk";--> statement-breakpoint
ALTER TABLE "pii_spans" ADD CONSTRAINT "pii_spans_offsets_chk" CHECK ("start_offset" >= 0 AND "end_offset" > "start_offset");
