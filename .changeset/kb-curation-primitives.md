---
'@getmunin/backend-core': minor
---

Add the agent-native primitives for closing the curation loop: when the
self-service agent flags a conversation for handover and a human reply
later clears the flag, that (question, answer) pair should eventually
become a KB document so the next end-user gets a real answer instead of
another handover.

This change ships the primitives — the actual curation work happens
through the operator's connected admin agent following the new skill.

- New skill: `skill://kb/curation` — the procedure an admin agent
  follows to turn resolved-handover conversations into draft KB docs.
- New admin tool: `kb_propose_curation_candidate({ subject, draftBody,
  sourceConversationId?, sourceMessageIds?, proposedTargetSpaceSlug? })`.
  Lazily creates the `kb-curation-inbox` KB space (audience: admin) on
  first call, then files the draft as a KB document tagged
  `curation`/`candidate`. Source conversation traceability lands in the
  body footer.
- New admin tool: `kb_publish_curation_candidate({ candidateDocumentId,
  targetSpaceSlug, audiences? })` — promotes a reviewed candidate into
  a target space, drops the candidate tags, defaults audiences to
  `['admin', 'self_service']` so the self-service agent can find it.
- New realtime event: `conversation.handover_resolved` — emitted when
  `convConversations.needsHumanAttention` flips from true to false via
  a non-internal user/agent message. Payload: `{ conversationId,
  messageId, authorType }`. Currently consumed by no one in OSS; a
  follow-up cloud curator runner will subscribe to drive auto-curation
  passes.

No CRUD UI for the curation inbox — candidates are reviewed via the
agent (or the existing `kb_list_documents` tool with `tag: 'candidate'`).
The dashboard's overview card (PR-B) surfaces the *count* of pending
candidates as an operational signal.
