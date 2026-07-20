DROP INDEX "slack_channel_routes_purpose_uq";--> statement-breakpoint
ALTER TABLE "slack_channel_routes" ADD COLUMN "conv_channel_id" text;--> statement-breakpoint
ALTER TABLE "slack_channel_routes" ADD CONSTRAINT "slack_channel_routes_conv_channel_id_conv_channels_id_fk" FOREIGN KEY ("conv_channel_id") REFERENCES "public"."conv_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "slack_channel_routes_conv_channel_uq" ON "slack_channel_routes" USING btree ("integration_id","conv_channel_id") WHERE conv_channel_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "slack_channel_routes_purpose_uq" ON "slack_channel_routes" USING btree ("integration_id","purpose") WHERE conv_channel_id IS NULL;