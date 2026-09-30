---
'@getmunin/agent-runtime': patch
'@getmunin/agent-host': patch
---

Pin the remaining internal prompts in plain-text snapshots under `src/__prompts__/`. The agent's reply and draft-request turns, the system notes every turn carries, the chat greeting seed, and the company profile generated from a website import are covered. The last inline prompt text (the conversation-context and company-context blocks, the note about messages left out of the context window, and the company-profile system prompt) now has a name. The prompts sent are unchanged.
