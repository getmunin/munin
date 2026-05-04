-- ============================================================================
-- Munin Conversations extras: per-org display-id allocator and RLS policies.
-- Applied during migrations after Drizzle schema and base RLS.
-- ============================================================================

-- ───────────────────────── per-org display id ─────────────────────────────
-- Pre-MAX-and-coalesce based allocation: given the org_id, return the next
-- display_id (1-based). Called inside the conversation-insert transaction so
-- the read-and-write is atomic. Locking via a row-level FOR UPDATE on the
-- max row would be overkill at our scale; a simple SELECT + INSERT inside
-- a transaction is monotonic enough — concurrent inserts in the same org
-- block on the unique (org_id, display_id) index and retry at the
-- application layer. Conversations service catches the conflict and retries.

-- SECURITY DEFINER + the org_id arg means the per-org sequence is computed
-- against ALL conversations in the org, not just rows visible to the caller's
-- RLS context. End-user-delegated calls would otherwise see only their own
-- conversations and re-pick display_id values already taken by other
-- end-users — colliding with conv_conversations_display_uq. Postgres aborts
-- the transaction after the first conflict, so the application-layer retry
-- can't recover. SECURITY DEFINER keeps the unique-sequence invariant correct
-- regardless of the caller's tenancy context.
CREATE OR REPLACE FUNCTION conv_next_display_id(p_org_id text) RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT COALESCE(MAX(display_id), 0) + 1
    FROM conv_conversations
    WHERE org_id = p_org_id;
  $$;

-- ───────────────────────── desk RLS ───────────────────────────────────────

ALTER TABLE conv_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE conv_channels FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON conv_channels;
CREATE POLICY tenant_isolation ON conv_channels
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

ALTER TABLE conv_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE conv_topics FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON conv_topics;
CREATE POLICY tenant_isolation ON conv_topics
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

ALTER TABLE conv_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE conv_contacts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON conv_contacts;
CREATE POLICY tenant_isolation ON conv_contacts
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

-- Conversations: end-user audience can ONLY see conversations where
-- end_user_id matches the GUC. Admin sees all org conversations.
ALTER TABLE conv_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conv_conversations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON conv_conversations;
CREATE POLICY tenant_isolation ON conv_conversations
  USING (
    app_bypass_rls()
    OR (
      org_id = app_org_id()
      AND (app_end_user_id() = '' OR end_user_id = app_end_user_id())
    )
  )
  WITH CHECK (
    app_bypass_rls()
    OR (
      org_id = app_org_id()
      AND (app_end_user_id() = '' OR end_user_id = app_end_user_id())
    )
  );

-- Messages: visibility inherits from the parent conversation. Internal
-- messages are additionally hidden from end-user audience even when the
-- conversation is theirs — that's the "agent draft" / "internal note"
-- pattern that's never customer-facing.
ALTER TABLE conv_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE conv_messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON conv_messages;
CREATE POLICY tenant_isolation ON conv_messages
  USING (
    app_bypass_rls()
    OR (
      org_id = app_org_id()
      AND EXISTS (
        SELECT 1 FROM conv_conversations c
        WHERE c.id = conv_messages.conversation_id
          AND (app_end_user_id() = '' OR c.end_user_id = app_end_user_id())
      )
      AND (app_end_user_id() = '' OR internal = false)
    )
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
