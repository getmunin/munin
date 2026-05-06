CREATE TABLE IF NOT EXISTS "outreach_campaigns" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "brief" text NOT NULL,
  "segment_id" text NOT NULL REFERENCES "crm_segments"("id") ON DELETE RESTRICT,
  "channel_id" text NOT NULL REFERENCES "conv_channels"("id") ON DELETE RESTRICT,
  "cadence_rules" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "cta_url" text,
  "enabled" boolean NOT NULL DEFAULT false,
  "unsubscribe_required" boolean NOT NULL DEFAULT true,
  "created_by_actor_type" varchar(16) NOT NULL,
  "created_by_actor_id" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "outreach_campaigns_org_idx" ON "outreach_campaigns" ("org_id");
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "outreach_campaigns_org_name_uq" ON "outreach_campaigns" ("org_id", "name");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "outreach_campaigns_enabled_idx" ON "outreach_campaigns" ("org_id", "enabled") WHERE "enabled" = true;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "outreach_proposals" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
  "campaign_id" text NOT NULL REFERENCES "outreach_campaigns"("id") ON DELETE CASCADE,
  "contact_id" text NOT NULL REFERENCES "crm_contacts"("id") ON DELETE CASCADE,
  "conversation_id" text REFERENCES "conv_conversations"("id") ON DELETE SET NULL,
  "kind" varchar(16) NOT NULL,
  "draft_subject" text,
  "draft_body" text NOT NULL,
  "evidence" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "proposed_send_at" timestamp with time zone,
  "status" varchar(16) NOT NULL DEFAULT 'pending',
  "proposed_by_actor_type" varchar(16) NOT NULL,
  "proposed_by_actor_id" text NOT NULL,
  "decided_by_actor_type" varchar(16),
  "decided_by_actor_id" text,
  "decided_at" timestamp with time zone,
  "sent_at" timestamp with time zone,
  "sent_message_id" text REFERENCES "conv_messages"("id") ON DELETE SET NULL,
  "failure_reason" text,
  "dismiss_reason" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "outreach_proposals_org_status_idx" ON "outreach_proposals" ("org_id", "status");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "outreach_proposals_campaign_idx" ON "outreach_proposals" ("campaign_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "outreach_proposals_contact_idx" ON "outreach_proposals" ("contact_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "outreach_proposals_conversation_idx" ON "outreach_proposals" ("conversation_id");
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "outreach_proposals_pending_pair_uq" ON "outreach_proposals" ("campaign_id", "contact_id", "kind") WHERE "status" = 'pending';
--> statement-breakpoint

ALTER TABLE "conv_conversations"
  ADD COLUMN IF NOT EXISTS "outreach_campaign_id" text REFERENCES "outreach_campaigns"("id") ON DELETE SET NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "conv_conversations_outreach_campaign_idx" ON "conv_conversations" ("outreach_campaign_id");
