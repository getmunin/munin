-- ============================================================================
-- Munin Conversations extras: per-org display-id allocator and RLS policies.
-- Applied during migrations after Drizzle schema and base RLS.
-- ============================================================================

-- ───────────────────────── per-org display id ─────────────────────────────
-- Given the org_id, return the next display_id (1-based). Called inside the
-- conversation-insert transaction, and the whole read-and-insert has to be
-- serialized per org: MAX(display_id) + 1 is a read, the row it predicts is
-- not visible to anyone else until the inserting transaction commits, so two
-- concurrent ingests in the same org both compute the same number. The second
-- one then blocks on conv_conversations_display_uq until the first commits and
-- dies with a duplicate-key error — which Postgres raises *inside* the caller's
-- transaction, aborting it, so no application-layer retry can recover. That is
-- an inbound email lost to a 500 (relayed on as SMTP 451) whenever two messages
-- for one org land at once, and the window is as wide as the slowest ingest
-- transaction: inbound attachments upload to object storage before the commit.
--
-- pg_advisory_xact_lock is therefore taken on (function, org) before the read
-- and held until the caller's transaction ends, which is exactly as long as the
-- predicted number stays invisible to everyone else. Allocation is per-org, so
-- one org's slow ingest never blocks another's. The function stays idempotent
-- within a transaction — calling it twice returns the same number, since the
-- lock is re-entrant and nothing is consumed by reading.
--
-- SECURITY DEFINER + the org_id arg means the sequence is computed against ALL
-- conversations in the org, not just rows visible to the caller's RLS context.
-- End-user-delegated calls would otherwise see only their own conversations and
-- re-pick display_id values already taken by other end-users. SECURITY DEFINER
-- alone is not enough for that: conv_conversations is FORCE ROW LEVEL SECURITY,
-- so policies apply to the table owner too, and switching to the owner only
-- bypasses RLS when that owner happens to be a superuser. That holds for a
-- local or CI database and not for a managed Postgres whose migration role is
-- not a superuser, where the end-user-scoped MAX comes back. The function-local
-- SET is what makes it true in both: it turns on the same GUC the policies read
-- for the duration of the call only, and Postgres restores the caller's value on
-- exit, so nothing downstream in the transaction inherits a bypass.
CREATE OR REPLACE FUNCTION conv_next_display_id(p_org_id text) RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, public
  SET app.bypass_rls = 'on'
  AS $$
    SELECT pg_advisory_xact_lock(hashtext('conv_next_display_id'), hashtext(p_org_id));
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

-- Attachments: visibility inherits from the parent conversation, exactly as
-- conv_messages does — an end-user audience may only reach rows on their own
-- conversation. Attachments hanging off an internal message are additionally
-- hidden from the end-user audience, mirroring the internal-note rule above,
-- so a staff-only screenshot can never leak through a delegated token.
--
-- Rows with message_id IS NULL are pending composer/widget uploads that are
-- not yet on any message; they stay visible to the org so the pending-upload
-- GC and the composer can see them.
ALTER TABLE conv_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE conv_attachments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON conv_attachments;
CREATE POLICY tenant_isolation ON conv_attachments
  USING (
    app_bypass_rls()
    OR (
      org_id = app_org_id()
      AND EXISTS (
        SELECT 1 FROM conv_conversations c
        WHERE c.id = conv_attachments.conversation_id
          AND (app_end_user_id() = '' OR c.end_user_id = app_end_user_id())
      )
      AND (
        app_end_user_id() = ''
        OR message_id IS NULL
        OR EXISTS (
          SELECT 1 FROM conv_messages m
          WHERE m.id = conv_attachments.message_id
            AND m.internal = false
        )
      )
    )
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
