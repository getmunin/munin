---
'@getmunin/backend-core': minor
'@getmunin/agent-host': minor
---

Add the `kb_import_website` MCP tool so admin agents can initiate a knowledge-base website scrape directly over `/mcp`. Previously the `task://web/scrape-website` job could only be enqueued via the `/v1/curator/jobs` control-plane endpoint (driven from the dashboard's website-import card). The new tool wraps that enqueue: it takes a homepage URL (bare domains accepted), validates it is publicly reachable, and returns the curator job id. Re-importing a URL with a scrape still pending returns the in-flight job instead of starting a second one.

The company-profile synthesis is now optional. The web-import handler reads a `synthesizeCompanyProfile` flag from the job's `sourceEventPayload` (defaulting to `true` when absent, so the dashboard onboarding flow is unchanged), and `kb_import_website` exposes it as a parameter. Set `synthesizeCompanyProfile: false` when importing third-party or topic pages so the import doesn't overwrite the company-profile document (slug `company-profile`) — which seeds the chat widget — with unrelated content.
