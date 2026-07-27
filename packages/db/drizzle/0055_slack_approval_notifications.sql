CREATE TABLE "slack_notification_links" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"integration_id" text NOT NULL,
	"subject_type" varchar(32) NOT NULL,
	"subject_id" text NOT NULL,
	"slack_channel_id" text NOT NULL,
	"slack_ts" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "slack_deliveries" ADD COLUMN "subject_key" text;--> statement-breakpoint
ALTER TABLE "slack_notification_links" ADD CONSTRAINT "slack_notification_links_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_notification_links" ADD CONSTRAINT "slack_notification_links_integration_id_slack_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."slack_integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "slack_notification_links_subject_uq" ON "slack_notification_links" USING btree ("integration_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "slack_notification_links_org_idx" ON "slack_notification_links" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "slack_deliveries_subject_idx" ON "slack_deliveries" USING btree ("subject_key","created_at");