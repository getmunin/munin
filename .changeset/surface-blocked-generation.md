---
"@getmunin/agent-runtime": minor
"@getmunin/agent-host": minor
---

A host's `beforeGenerate` gate can now return a `notice` (`{ title, detail? }`) with its denial, meaning the denial needs someone to act and won't clear on its own. A quota that has run out is the case it was added for. Until now any denial was silent: the reply was skipped and one log line written, with no message to the visitor, no handover and no alert. A visitor on an organization with no AI quota left got no answer, and nobody at the organization could tell why.

When a chat reply is denied with a notice, the conversation now falls back exactly as it does when the provider keeps failing. A reply is handed over to a human, using the notice title as the reason and, when the agent sends directly, the localized "a teammate will follow up" message to the visitor. A draft request gets an internal note. A greeting gets the static greeting. The agent host also opens an organization alert (source `quota`, severity `error`) with the notice's title and detail. Owners are emailed under the existing `quota` notification policy. The same alert opens when scheduled curator work is denied with a notice, so an organization with no live conversations still finds out. The alert resolves on the next successful generation.

A denial without a notice keeps the old behaviour (skip and log), which is right for transient gates such as a per-minute rate limit, where the awaiting-reply sweep retries on its own. `onGenerateBlocked` now receives the notice as a second argument.
