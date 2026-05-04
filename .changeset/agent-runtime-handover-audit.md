---
'@getmunin/agent-runtime': minor
---

Add a post-turn audit pass that catches a common LLM failure mode: the agent
writes "let me flag this for a teammate" but never actually calls
`conv_request_handover_in_my_conversation`, leaving the dashboard's
`needsHumanAttention` count out of sync with what the user was told.

After `runAgent` produces a reply, the conversation handler now fires a small
classifier LLM call that reads the (last user message, agent reply, names of
tools the agent called this turn) and returns a structured verdict
`{ handover: boolean, reason: string }`. If the audit says handover but the
agent didn't call the tool itself, the runtime force-calls it before posting
the reply.

New exports: `auditReply`, type `AuditReplyArgs`, type `AuditVerdict`. New
fields on `HandlerConfig`: `auditEnabled?: boolean` (default true),
`auditModel?: string` (defaults to the main turn's model). New field on
`AgentConfig`: `responseFormat?: 'json_object'` (the audit uses it; consumers
can use it for any classifier-style call).

Fails open on provider errors or unparseable JSON — the agent's reply gets
posted as-is and the failure is logged, so a misbehaving audit can't drop
real replies on the floor.
