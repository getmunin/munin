---
'@getmunin/backend-core': patch
---

fix(mcp): allow OAuth-authorized callers (`actor.type === 'user'`) to reach admin tools. The audience-derivation gate added in #289 required `actor.type === 'admin_agent'`, which excluded the OAuth bearer-token flow used by claude.ai-style MCP connectors and collapsed every admin tool to `self_service`. Replace the actor-type equality check with an allowlist (`'admin_agent'` + `'user'`) so the defense-in-depth against `widget_agent` / `end_user_agent` / `partner` / `system` actors with a forged admin audience stays in place while OAuth users get the admin surface their granted scopes already entitle them to.
