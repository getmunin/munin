---
'@getmunin/backend-core': patch
'@getmunin/core': patch
---

Tell MCP agents the real API host, not the MCP host. The connect-time server instructions and the `{{API_URL}}` substitution in skill bodies both derived the "API base URL" from `NEXT_PUBLIC_MCP_URL`'s origin, so any deployment that splits the API and MCP onto separate subdomains handed agents the wrong host. Coding agents following `skill://playbooks/frontend-integration` then baked it into customer frontends as `NEXT_PUBLIC_API_URL` / `VITE_API_URL`. It worked only because both hostnames happen to route to the same backend today; anything that splits them (a separate service, per-host WAF or rate-limit rules, a route narrowed to `/mcp`) would break shipped customer pages, and the same page already mixed hosts — the dashboard embed snippet and the CMS delivery API's own `_tracking` block resolve the API host via `MUNIN_API_URL`.

Both call sites now use `readApiBaseUrl()`, the resolver every other self-referencing URL already goes through, and the instructions state the API base URL and the MCP endpoint URL as two separate facts instead of claiming one origin serves both. `readApiBaseUrl()` gained a fallback to `NEXT_PUBLIC_MCP_URL`'s origin ahead of `http://localhost:3001`, so single-host and tunnel setups that never set `MUNIN_API_URL` keep resolving to a reachable host.

Two related fixes: the Slack bridge built avatar image URLs (`/v1/slack/avatars/*.png`, fetched by Slack) off the MCP origin, and the in-process agent runner never passed an API base URL at all, so its skills reached the model with a literal, unsubstituted `{{API_URL}}`.

Skills and playbooks stopped naming deployments. Hosts and hosting tiers are per-deployment facts an agent cannot verify from inside a tenant, so they no longer appear in skill bodies: `skill://playbooks/frontend-integration` describes allowlist behavior by the env var that controls it rather than by tier, `skill://slack/connect-slack` keys its prerequisite step off `slack_get_status.appConfigured` and gets the manifest URLs substituted from `{{API_URL}}` instead of asking the agent to hand-replace a placeholder, `skill://playbooks/data-migration` is retitled "Data migration (server ⇄ server)" (slug unchanged), and the analytics and outreach skills use `example.com` in sample arguments.
