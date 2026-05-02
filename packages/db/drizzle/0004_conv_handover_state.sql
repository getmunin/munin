-- Conversation handover state.
--
-- (1) Per-conversation "needs human attention" flag set by the agent when it
--     punts to a human. Cleared on first user-author reply or status=closed.
-- (2) Extend the existing claims table to support both agent and user
--     claimers (for the human take-over lock on a conversation), enforced by
--     a CHECK constraint that exactly one of agent_id / user_id is set.

ALTER TABLE "conv_conversations"
  ADD COLUMN "needs_human_attention" boolean DEFAULT false NOT NULL,
  ADD COLUMN "needs_human_attention_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX "conv_conversations_needs_attention_idx"
  ON "conv_conversations" ("org_id", "needs_human_attention_at")
  WHERE "needs_human_attention" = true;
--> statement-breakpoint
ALTER TABLE "claims" ALTER COLUMN "agent_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "user_id" text;
--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_claimer_check"
  CHECK ((agent_id IS NOT NULL) <> (user_id IS NOT NULL));
--> statement-breakpoint
CREATE INDEX "claims_user_idx" ON "claims" ("user_id");
