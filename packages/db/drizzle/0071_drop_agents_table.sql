-- Remove the agent-as-actor identity model. `agents` never had a writer, and
-- claims.agent_id could only be set by a claimer whose id starts with `agt_`,
-- which no credential path has ever produced. Conversation claims are an
-- operator lock; "the AI is handling this" lives in conv_conversations.agent_mode.
--
-- The guards below abort the deploy rather than silently deleting data if any
-- of that turns out to be false in a real database. Two details matter:
--   * these tables are FORCE RLS, so the owner sees zero rows and every guard
--     would pass vacuously without the bypass;
--   * the row checks run through EXECUTE so PL/pgSQL does not plan a reference
--     to a dropped relation when this migration is re-run.
DO $$
DECLARE
  leftover bigint;
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);

  IF to_regclass('public.agents') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM agents' INTO leftover;
    IF leftover > 0 THEN
      RAISE EXCEPTION 'agents holds % row(s); agent identities exist that this migration would delete', leftover;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'claims' AND column_name = 'agent_id'
  ) THEN
    EXECUTE 'SELECT count(*) FROM claims WHERE agent_id IS NOT NULL' INTO leftover;
    IF leftover > 0 THEN
      RAISE EXCEPTION 'claims.agent_id holds % non-null row(s); agent-held claims exist', leftover;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tokens' AND column_name = 'agent_id'
  ) THEN
    EXECUTE 'SELECT count(*) FROM tokens WHERE agent_id IS NOT NULL' INTO leftover;
    IF leftover > 0 THEN
      RAISE EXCEPTION 'tokens.agent_id holds % non-null row(s); agent-bound tokens exist', leftover;
    END IF;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "claims" DROP COLUMN IF EXISTS "agent_id";--> statement-breakpoint
ALTER TABLE "tokens" DROP COLUMN IF EXISTS "agent_id";--> statement-breakpoint
DROP TABLE IF EXISTS "agents";
