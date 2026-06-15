---
'@getmunin/mcp-toolkit': minor
'@getmunin/backend-core': minor
---

Auto-feed the tenant's API base URL (and org id) to MCP agents so coding-agent platforms (Lovable, Bolt, v0, …) stop asking for it. The resolved API origin is now stated in the MCP server instructions, and `{{API_URL}}` / `{{ORG_ID}}` placeholders in skill bodies are substituted at `skills_read` / `resources/read` time from the authenticated session. The frontend-integration playbook now tells agents to use the provided value instead of asking the operator.
