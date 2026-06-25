---
"@getmunin/types": minor
"@getmunin/db": minor
"@getmunin/backend-core": minor
"@getmunin/dashboard-pages": minor
---

feat(conv): per-channel default agent mode

Add `defaultAgentMode` (`auto` | `draft_only` | `off`) to conversation channels. New conversations inherit the channel's mode when no explicit mode is passed — including inbound replies that fail threading and open a fresh conversation. Set an outreach-only inbox to `draft_only` so prospect replies are always drafted for human approval and never auto-sent, even when threading can't link the reply to its originating conversation. Configurable via `conv_setup_email_channel` and the email channel dialog.
