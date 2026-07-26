---
'@getmunin/backend-core': patch
---

Build the Slack OAuth redirect URI from the auth origin (`NEXT_PUBLIC_AUTH_URL`) instead of the MCP resource origin, so browser-facing install flows land on the `api.*` host that Slack apps register as the callback. Falls back to the MCP origin when no auth URL is set, matching single-origin self-host deployments.
