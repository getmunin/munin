---
'@getmunin/core': minor
---

AgentHostRunner: realtime + chat MCP + curator workers now run fully in-process. Closes the prod 401-reconnect loop on stale admin API keys.

**Why.** Prior to this change, the AgentHostRunner subscribed to realtime events over WebSocket (`/api/v1/realtime`) and made chat-side MCP calls over HTTP, both authenticated with a per-org admin API key. When that key drifted (e.g. an org was deleted but its `agent_configs.admin_api_key` row stuck around), the WebSocket 401'd every 30 seconds forever — observed in prod for `org_fgf0a6f1fwu6nfa6aq3xwf` at attempt 411+ before this fix. PR #211 had already moved the prompts/skills loader path in-process, but realtime + chat + curator stayed HTTP and kept burning.

**What changed.**

- New `RealtimeEventBus` provider in `@getmunin/backend-core/realtime`. Wraps `DbListenerService` so the same Postgres `NOTIFY munin_events` stream the WS gateway already consumes fans out to in-process subscribers with `{ orgId, endUserId? }` filtering identical to the gateway's. Adds an in-memory `publishConversationTyping` / `subscribeAgentTyping` channel for the runner-emitted typing signal (no DB write — typing is ephemeral). The gateway also subscribes to this and pushes to widget WS clients on the matching conversation channel.
- New `openEndUserAgentMcpClient(...)` in `@getmunin/backend-core/agent/in-process-context.ts`. Mirrors the existing admin in-process opener but synthesizes an `end_user_agent` actor with `audience='self_service'`, the user's default org membership, and proper `applyTenancyGUCs(actor)` per call — so RLS still enforces end-user scoping even though the auth guard is bypassed.
- New `buildEndUserAgentActor({ orgId, endUserId, scopes?, audiences? })` in `@getmunin/core`, sibling of `buildAdminAgentActor`.
- `runner.service.ts`: `createRealtimeClient({ baseUrl, adminApiKey, … })` → `this.eventBus.subscribe({ orgId }, handlers)`. `openMcp: ({ delegatedToken }) => openHttpMcpClient(HTTP)` → `openMcp: ({ endUserId }) => openEndUserAgentMcpClient(IN-PROCESS)`. `realtime.sendConversationTyping(...)` → `eventBus.publishConversationTyping(orgId, ...)`. Curator workers and `runWebImportJob` now receive an in-process `AgentMcpClient` (built from `openAdminAgentMcpClient`) instead of opening their own HTTP MCP.
- `conversation-handler.ts`: dropped `getDelegatedToken`, `tokenCache`, and the `TOKEN_REFRESH_MARGIN_MS` constant. The chat handler passes `endUserId` directly to `deps.openMcp` — no token mint, no REST round-trip per message. `mintDelegatedToken` REST endpoint stays for external callers (widget).
- `runSkillPass`: signature dropped `baseUrl`/`adminApiKey`/`clientName`, added `mcp: McpToolHandle` + `skills: SkillReader`. No HTTP MCP connect.
- `runWebImportJob`: signature dropped `baseUrl`/`adminApiKey`, added `mcp: McpToolHandle`. No HTTP MCP connect.

**Naming sweep alongside.** The pre-existing public exports were asymmetric (`openAgentMcpClient` paired with the new `openDelegatedMcpClient`, plus a misleadingly-named `openMcpClient` for the HTTP transport). Renamed for clarity:

- `openAgentMcpClient` → `openAdminAgentMcpClient`
- `openDelegatedMcpClient` → `openEndUserAgentMcpClient`
- `openMcpClient` (HTTP) → `openHttpMcpClient`

Pairs now match `ActorType` and the transport is explicit. No external consumers yet, so safe.

**What still requires the admin API key.** The REST control plane (`createMuninRestClient`) still goes over HTTP, since lifting Nest controllers in-process is a much larger refactor with low value for low-traffic config reads. The runner still bails if no admin key is configured — but the realtime/MCP/curator paths no longer depend on it.

**Closes** the prod incident on stale admin keys for both the realtime intake and the per-message chat MCP path.
