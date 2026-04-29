CREATE TABLE "conv_email_inbound_state" (
	"channel_id" text PRIMARY KEY NOT NULL,
	"last_uid_seen" bigint,
	"last_polled_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conv_message_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"message_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"status" varchar(16) DEFAULT 'queued' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"error" text,
	"message_id_header" text,
	"in_reply_to_header" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conv_email_inbound_state" ADD CONSTRAINT "conv_email_inbound_state_channel_id_conv_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."conv_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conv_message_deliveries" ADD CONSTRAINT "conv_message_deliveries_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conv_message_deliveries" ADD CONSTRAINT "conv_message_deliveries_message_id_conv_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."conv_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conv_message_deliveries" ADD CONSTRAINT "conv_message_deliveries_channel_id_conv_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."conv_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conv_message_deliveries_drain_idx" ON "conv_message_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "conv_message_deliveries_org_idx" ON "conv_message_deliveries" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "conv_message_deliveries_msg_idx" ON "conv_message_deliveries" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "conv_message_deliveries_msgid_idx" ON "conv_message_deliveries" USING btree ("message_id_header");