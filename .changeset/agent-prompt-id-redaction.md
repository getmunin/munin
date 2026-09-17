---
'@getmunin/agent-runtime': minor
---

Keep national identity numbers out of the LLM prompt.

Conversation turns, quoted email history, tool results and the supervision pass now run through the national-ID detectors before they reach a model, and a match is replaced by a marker rather than masked — the agent learns that a number was supplied without ever seeing a digit of it.

This runs unconditionally at high confidence for all three detectors, independent of whatever an org has configured for storage. Whether a tenant wants these numbers kept on disk is a policy question; sending them to a third-party inference provider is not the same question, and it has a different default.
