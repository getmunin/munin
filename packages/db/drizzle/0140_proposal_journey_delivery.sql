-- Journey proposals carried their delivery controls (channel, format,
-- template pin, send policy, auto-approval) inside the free-form `evidence`
-- jsonb, which is reviewer-facing context. They move to their own column so
-- the send path reads one validated shape, and a CHECK keeps the column set
-- on journey proposals only.
ALTER TABLE "outreach_proposals" ADD COLUMN IF NOT EXISTS "journey_delivery" jsonb;--> statement-breakpoint
DO $$
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);
  UPDATE "outreach_proposals"
     SET "journey_delivery" =
           '{"channel":"email","format":"markdown","templateId":null,"templateHash":null,"preheader":null,"policy":{"class":"marketing","cooldownHoursAfterConversation":24},"auto":false}'::jsonb
           || CASE WHEN jsonb_typeof("evidence" -> 'journeyMessage') = 'object'
                   THEN "evidence" -> 'journeyMessage' ELSE '{}'::jsonb END,
         "evidence" = "evidence" - 'journeyMessage' - 'enrollmentId' - 'stepRunId'
   WHERE "kind" = 'journey' AND "journey_delivery" IS NULL;
END $$;--> statement-breakpoint
ALTER TABLE "outreach_proposals" DROP CONSTRAINT IF EXISTS "outreach_proposals_journey_delivery_ck";--> statement-breakpoint
ALTER TABLE "outreach_proposals" ADD CONSTRAINT "outreach_proposals_journey_delivery_ck"
  CHECK (("kind" = 'journey') = ("journey_delivery" IS NOT NULL));
