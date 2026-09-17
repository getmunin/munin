-- Durable fan-out of alert emails. One row per (alert, recipient); the unique
-- key is what makes the enqueue idempotent, so a fault that reopens and fires
-- repeatedly still mails each person once.
--
-- Written idempotently so a corrected journal timestamp can re-run it.

CREATE TABLE IF NOT EXISTS "alert_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"alert_id" text NOT NULL,
	"recipient_user_id" text NOT NULL,
	"email" text NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"error" text,
	"delivered_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alert_notifications_org_id_orgs_id_fk') THEN
    ALTER TABLE "alert_notifications" ADD CONSTRAINT "alert_notifications_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alert_notifications_alert_id_org_alerts_id_fk') THEN
    ALTER TABLE "alert_notifications" ADD CONSTRAINT "alert_notifications_alert_id_org_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."org_alerts"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alert_notifications_recipient_user_id_users_id_fk') THEN
    ALTER TABLE "alert_notifications" ADD CONSTRAINT "alert_notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "alert_notifications_alert_recipient_uq" ON "alert_notifications" USING btree ("alert_id","recipient_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alert_notifications_pending_idx" ON "alert_notifications" USING btree ("next_attempt_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alert_notifications_org_idx" ON "alert_notifications" USING btree ("org_id");