ALTER TABLE "analytics_search_events" ADD COLUMN IF NOT EXISTS "tracker_id" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "analytics_search_events" ADD CONSTRAINT "analytics_search_events_tracker_id_analytics_trackers_id_fk" FOREIGN KEY ("tracker_id") REFERENCES "public"."analytics_trackers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_search_events_tracker_idx" ON "analytics_search_events" USING btree ("org_id","tracker_id","created_at");
