-- Bookings a self-service session made without a verified email: an
-- anonymous chat visitor or a phone caller. Each row records the
-- conversation that made the booking, so that conversation (and only it) may
-- change or cancel it afterwards, and so the number of such bookings per
-- conversation can be capped. `email` is the address the guest gave, kept to
-- re-check with the vendor that the booking is still filed under it before
-- any change. The tenant_isolation policy lives in connectors.sql.
CREATE TABLE IF NOT EXISTS "bookings_guest_bookings" (
	"org_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"booking_ref" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_guest_bookings_pk" PRIMARY KEY("conversation_id","connection_id","booking_ref")
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bookings_guest_bookings" ADD CONSTRAINT "bookings_guest_bookings_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bookings_guest_bookings" ADD CONSTRAINT "bookings_guest_bookings_conversation_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conv_conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bookings_guest_bookings" ADD CONSTRAINT "bookings_guest_bookings_connection_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connector_connections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_guest_bookings_org_idx" ON "bookings_guest_bookings" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_guest_bookings_connection_idx" ON "bookings_guest_bookings" USING btree ("connection_id");
