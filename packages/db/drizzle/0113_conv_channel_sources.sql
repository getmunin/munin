-- Channel sources: which knowledge-base spaces and which connector
-- connections the self-service agent may draw on in one channel's
-- conversations, so one org can run several sites (each with its own widget,
-- KB space and store connection) without their answers crossing over.
--
-- conv_channel_kb_spaces narrows KB reads through the kb_documents and
-- kb_document_chunks policies (kb.sql), keyed by the app.kb_space_ids GUC the
-- tenancy layer derives from the actor's conversation. No rows for a channel
-- means no restriction.
--
-- conv_channel_connections pins at most one connection per connector domain
-- per channel; ConnectorsService.resolveScope reads it. connection_id has no
-- ON DELETE action: deleteConnection refuses while a binding exists, so a
-- deleted store connection can never silently widen a channel back to
-- whichever connection is left. An org delete still cascades through
-- channel_id. The tenant_isolation policies live in conv-channels.sql.
CREATE TABLE IF NOT EXISTS "conv_channel_kb_spaces" (
	"org_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"space_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conv_channel_kb_spaces_channel_id_space_id_pk" PRIMARY KEY("channel_id","space_id")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conv_channel_connections" (
	"org_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"domain" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conv_channel_connections_channel_id_connection_id_pk" PRIMARY KEY("channel_id","connection_id")
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conv_channel_kb_spaces" ADD CONSTRAINT "conv_channel_kb_spaces_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conv_channel_kb_spaces" ADD CONSTRAINT "conv_channel_kb_spaces_channel_id_conv_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."conv_channels"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conv_channel_kb_spaces" ADD CONSTRAINT "conv_channel_kb_spaces_space_id_kb_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."kb_spaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conv_channel_connections" ADD CONSTRAINT "conv_channel_connections_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conv_channel_connections" ADD CONSTRAINT "conv_channel_connections_channel_id_conv_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."conv_channels"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conv_channel_connections" ADD CONSTRAINT "conv_channel_connections_connection_id_connector_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connector_connections"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conv_channel_kb_spaces_org_idx" ON "conv_channel_kb_spaces" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conv_channel_connections_channel_domain_uq" ON "conv_channel_connections" USING btree ("channel_id","domain");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conv_channel_connections_connection_idx" ON "conv_channel_connections" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conv_channel_connections_org_idx" ON "conv_channel_connections" USING btree ("org_id");
