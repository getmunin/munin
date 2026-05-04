---
'@getmunin/backend-core': minor
'@getmunin/agent-runtime': minor
---

Add a post-turn audit pass that reads (last user message, agent reply, tool
names called this turn, the org's topic catalog) and returns a structured
list of follow-up actions for the runtime to dispatch. Catches the common
LLM failure mode where the agent's text says "let me flag this for a
teammate" but no handover tool was actually called, plus generalizes to
other automatic moves the runtime should make on the conversation.

Action types supported today:

- `request_handover` — reply implies handover but no handover tool was
  called. Force-calls `conv_request_handover_in_my_conversation` via the
  per-conversation delegated MCP.
- `close_conversation` — end-user clearly said "thanks, that's all".
  Calls `POST /api/conversations/:id/status` with `status: closed`.
- `snooze_conversation` — user asked to be followed up later. Same
  endpoint with `status: snoozed` + `snoozeUntil = now + untilHours`.
- `mark_spam` — user message is automated / promotional / off-topic.
  Same endpoint with `status: spam`.
- `set_topic` — picks one of the org's existing topic slugs. Calls a new
  endpoint `POST /api/conversations/:id/topic`.

Audit dispatch routes via the existing admin REST client the handler
already holds (it's how the handler fetches history and posts replies).
No new MCP factory needed — the runner doesn't have to wire anything up.
The only new dep on the handler side is three more methods on
`MuninRestClient` (`changeStatus`, `setTopic`, `listTopics`) which the
package's `createMuninRestClient` factory implements against the new
backend endpoints.

OSS backend-core adds:

- New admin tool `conv_set_topic({ conversationId, topicId | null })` for
  any admin agent (Claude Desktop, the cloud curator) that wants to apply
  topics from MCP.
- New REST endpoints `POST /api/conversations/:id/topic` and
  `GET /api/conversations/topics` (admin) — both wrap existing service
  methods.

The audit only ever picks topic slugs from the catalog the runtime fetched
via `rest.listTopics()`; the LLM cannot invent slugs (parser drops
anything not in the catalog).

Failure mode is fail-open: provider errors or unparseable JSON return
`{ actions: [] }` so a misbehaving audit cannot silence real replies.

New `@getmunin/agent-runtime` exports: `auditConversation`, types
`AuditAction`, `AuditConversationArgs`, `AuditTopic`, `AuditVerdict`,
`ConversationStatus`, `ConversationTopic`. New `HandlerConfig` fields:
`auditEnabled?: boolean` (default true), `auditModel?: string`. New
`AgentConfig` field: `responseFormat?: 'json_object'`.
