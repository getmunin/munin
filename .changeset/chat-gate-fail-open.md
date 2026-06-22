---
"@getmunin/agent-runtime": patch
---

Fail open when the chat pre-generate gate errors. The `beforeGenerate` hook (a quota/usage gate) was awaited without a guard, so a thrown error rejected the whole reply attempt and silently dropped the visitor's reply. It now degrades to allow — mirroring the curator's scheduled-work gate — and logs the error (`beforeGenerate failed, proceeding: …`) and any explicit denial (`reply suppressed: …`) so the verdict is observable. A gate outage can no longer swallow a customer's reply.
