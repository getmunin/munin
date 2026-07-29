ALTER TABLE "analytics_trackers" ADD COLUMN "canonical_locales" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "analytics_view_events" ADD COLUMN "client_view_id" varchar(64);--> statement-breakpoint
CREATE INDEX "analytics_search_events_visitor_idx" ON "analytics_search_events" USING btree ("org_id","visitor_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_view_events_client_view_uq" ON "analytics_view_events" USING btree ("org_id","client_view_id") WHERE client_view_id IS NOT NULL;