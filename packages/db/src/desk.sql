-- ============================================================================
-- Munin Helpdesk extras: per-org display-id allocator and RLS policies.
-- Applied during migrations after Drizzle schema and base RLS.
-- ============================================================================

-- ───────────────────────── per-org display id ─────────────────────────────
-- Pre-MAX-and-coalesce based allocation: given the org_id, return the next
-- display_id (1-based). Called inside the conversation-insert transaction so
-- the read-and-write is atomic. Locking via a row-level FOR UPDATE on the
-- max row would be overkill at our scale; a simple SELECT + INSERT inside
-- a transaction is monotonic enough — concurrent inserts in the same org
-- block on the unique (org_id, display_id) index and retry at the
-- application layer. Helpdesk service catches the conflict and retries.

CREATE OR REPLACE FUNCTION desk_next_display_id(p_org_id text) RETURNS integer
  LANGUAGE sql VOLATILE
  AS $$
    SELECT COALESCE(MAX(display_id), 0) + 1
    FROM desk_conversations
    WHERE org_id = p_org_id;
  $$;

-- ───────────────────────── desk RLS ───────────────────────────────────────

ALTER TABLE desk_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE desk_channels FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON desk_channels;
CREATE POLICY tenant_isolation ON desk_channels
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

ALTER TABLE desk_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE desk_topics FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON desk_topics;
CREATE POLICY tenant_isolation ON desk_topics
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

ALTER TABLE desk_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE desk_contacts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON desk_contacts;
CREATE POLICY tenant_isolation ON desk_contacts
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

-- Conversations: end-user audience can ONLY see conversations where
-- end_user_id matches the GUC. Admin sees all org conversations.
ALTER TABLE desk_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE desk_conversations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON desk_conversations;
CREATE POLICY tenant_isolation ON desk_conversations
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
ALTER TABLE desk_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE desk_messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON desk_messages;
CREATE POLICY tenant_isolation ON desk_messages
  USING (
    app_bypass_rls()
    OR (
      org_id = app_org_id()
      AND EXISTS (
        SELECT 1 FROM desk_conversations c
        WHERE c.id = desk_messages.conversation_id
          AND (app_end_user_id() = '' OR c.end_user_id = app_end_user_id())
      )
      AND (app_end_user_id() = '' OR internal = false)
    )
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
