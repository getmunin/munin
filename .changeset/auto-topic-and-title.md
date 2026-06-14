---
'@getmunin/backend-core': minor
'@getmunin/types': minor
---

Automatically triage new inbound conversations with a topic and a title.

- New `skill://conv/set-topic-and-title` curator skill (fast tier, `conv_` tools): reads a freshly-created conversation, tags it with the best-fitting topic (creating one only when confident none fit), and gives it a short title when it has no subject yet.
- New `conv_set_subject` MCP tool (admin, `conv:write`) so the skill can title conversations that arrive without a subject (chat, SMS, voice). Email subjects are left untouched.
- The job is enqueued on the first inbound end-user message across every channel: email (new thread), generic webhook channels, the chat widget, and `conv_*`/control-plane conversation creation. A per-conversation dedupe key keeps it idempotent.
