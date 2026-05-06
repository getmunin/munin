---
'@getmunin/backend-core': patch
---

Fix self-service agent detection in realtime gateway. The dashboard's "agent connected" indicator was checking `actor.audiences.includes('self_service')` — but OSS admin API keys default to `['admin']` only (cloud mints runner keys with both audiences as a flag). Self-hosters running `@getmunin/agent-runtime` against their local Munin saw "no agent connected" even with chat working fine.

Drop the audience overlay. A live WebSocket subscriber that isn't an end-user-agent token *is* the runner — there's no other admin caller that opens a sustained WS in OSS (dashboard uses session cookies, control-plane scripts don't subscribe). Removes the OSS/cloud asymmetry. No migration needed; existing keys work immediately.
