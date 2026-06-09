CREATE TABLE "analytics_visitor_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"visitor_id" varchar(64) NOT NULL,
	"end_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytics_search_events" ADD COLUMN "end_user_id" text;--> statement-breakpoint
ALTER TABLE "analytics_trackers" ADD COLUMN "identity_verification_secret" text;--> statement-breakpoint
ALTER TABLE "analytics_trackers" ADD COLUMN "require_verified_identity" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "analytics_view_events" ADD COLUMN "end_user_id" text;--> statement-breakpoint
ALTER TABLE "analytics_visitor_identities" ADD CONSTRAINT "analytics_visitor_identities_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_visitor_identities" ADD CONSTRAINT "analytics_visitor_identities_end_user_id_end_users_id_fk" FOREIGN KEY ("end_user_id") REFERENCES "public"."end_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_visitor_identities_visitor_uq" ON "analytics_visitor_identities" USING btree ("org_id","visitor_id");--> statement-breakpoint
CREATE INDEX "analytics_visitor_identities_end_user_idx" ON "analytics_visitor_identities" USING btree ("org_id","end_user_id");--> statement-breakpoint
ALTER TABLE "analytics_search_events" ADD CONSTRAINT "analytics_search_events_end_user_id_end_users_id_fk" FOREIGN KEY ("end_user_id") REFERENCES "public"."end_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_view_events" ADD CONSTRAINT "analytics_view_events_end_user_id_end_users_id_fk" FOREIGN KEY ("end_user_id") REFERENCES "public"."end_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_search_events_end_user_idx" ON "analytics_search_events" USING btree ("org_id","end_user_id","created_at");--> statement-breakpoint
CREATE INDEX "analytics_view_events_end_user_idx" ON "analytics_view_events" USING btree ("org_id","end_user_id","created_at");