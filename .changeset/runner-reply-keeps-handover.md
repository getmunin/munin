---
'@getmunin/agent-runtime': patch
'@getmunin/backend-core': patch
---

The support agent's own replies no longer resolve a pending handover. Before, only the turn that raised the handover kept the flag up; when the customer wrote again ("should I stay in the chat?") the agent's next reply cleared `needsHumanAttention`, emitted `conversation.handover_resolved` (shown in Slack as "Handover resolved — a human replied"), dropped the conversation from the needs-you queue, and queued a knowledge-base gap-curation pass that treated the agent's holding reply as a teammate's answer.

Both runner REST clients (`createMuninRestClient` and the in-process client) now always send runner replies with `preserveAttention: true`, and `postAgentMessage` no longer takes a `preserveAttention` option. A handover is resolved by a teammate replying, an operator's agent replying through `conv_send_message` or the control plane, or by closing the conversation.
