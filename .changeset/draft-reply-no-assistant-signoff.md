---
'@getmunin/agent-runtime': patch
---

Drafted replies no longer sign off with the assistant's name. A draft is sent by a human teammate as themselves, so a closing like "Mvh <AI name>" put the wrong name under their message. Every draft — one a teammate asks for, or a reply on a channel that only drafts — now leaves the configured AI name out of the system prompt, and tells the agent not to sign, introduce itself by name or present itself as an AI, ending without a closing so the teammate adds their own.
