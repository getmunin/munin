# Munin — agent guide

MCP-first customer platform made for the agentic era (KB, Conversations, CRM, CMS, Outreach). The agent is the primary UI: agents act through MCP tools served at `/mcp`. The dashboard at `apps/web` is a thin shell over the `/v1/*` control plane; `/v1` controllers and MCP tools must both stay thin wrappers over the same service methods — logic lives in the service, never in a controller or tool handler.

## Repository layout

Monorepo on pnpm + Turborepo.

- `apps/backend` — NestJS entry that composes `@getmunin/backend-core` with single-tenant `AuthModule`. Port 3001. Exposes `/mcp`, `/auth/*`, `/.well-known/oauth-*`, and the `/v1/*` control plane.
- `apps/web` — Next.js 15 dashboard + landing. Port 3000. Calls `apps/backend` via `/v1/*`.
- `apps/chat-widget` — embeddable browser bundle consumed via `mn_widget_*` keys.
- `packages/backend-core` — shared NestJS modules. Where business logic lives.
- `packages/dashboard-pages` — React pages reused by OSS and cloud webs.
- `packages/{core,db,types,sdk,mcp-toolkit,ui}` — non-Nest building blocks.
- `packages/{agent-host,agent-runtime}` — durable per-org LLM runner that drains the curator queue.
- `packages/widget-voice` — Vapi voice glue.

## Module map (`packages/backend-core/src/modules/`)

| Module | Tools prefix | Notes |
|---|---|---|
| `kb` | `kb_*` | Documents, spaces, hybrid search (BM25 + pgvector), curation candidates. |
| `conv` | `conv_*` | Email / SMS / voice / widget channels via the channel-adapter contract (`packages/backend-core/src/modules/conv/CLAUDE.md`). |
| `crm` | `crm_*` | Contacts, companies, deals, pipelines, segments, merge proposals. |
| `cms` | `cms_*` | Collections, entries, locales, assets, scheduled publishing, public delivery API. |
| `outreach` | `outreach_*` | Propose-only outbound campaigns. Never auto-sends. |
| `curator` | — | Background job queue (`curator_jobs`) running `skill://*` and `task://*` URIs. |
| `web` | — | Website scraper (single `task://web/scrape-website`). |
| `playbooks` | — | Cross-module packaged workflows (skill markdown only, no tools). |

Each module typically has `<mod>.module.ts`, `<mod>.service.ts`, `<mod>.tools.ts`, and a `skills/` directory of markdown procedures.

## Integration architecture

Three integration categories, three homes. Route new "integrate with X" work by asking what X is:

- **Messaging channel** — a surface customers write to us on (email, SMS, voice, widget). Implement a channel adapter in `conv` (contract: `packages/backend-core/src/modules/conv/CLAUDE.md`).
- **Operator bridge** — where our team works (Slack; later Teams). One root module per vendor. Bridges subscribe to domain events by registering an `EventSink` on `WebhookDispatcher` (`packages/core/src/webhooks.ts`); sinks run inside the emitting transaction and must only enqueue durable work — external I/O belongs in the module's own out-of-band worker. Inbound vendor webhooks are signature-verified public controllers, and inbound actions run through existing module services as the mapped org member.
- **Connector** — a customer's system of record we answer questions from (Shopify, Magento, Gastroplanner). Plumbing lives in the `connectors` trunk module (connection storage, credential encryption, vendor registry, `connectors_*` admin tools); typed read surfaces live in domain modules (`commerce`, `bookings`) whose vendor adapters register into the trunk registry. A domain module is a distinct customer-facing noun with its own read contract (orders, bookings, invoices) — never a vendor. Connector reads are live: no vendor data is persisted in Munin.

Operator bridges and connectors both surface in the dashboard on the single Integrations page (`packages/dashboard-pages/src/pages/integrations.tsx`), one section per category, cards under `packages/dashboard-pages/src/components/integrations/`.

## MCP surface

- `@McpTool({ name, audiences, scopes, … })` decorator on Nest provider methods registers the tool. `audiences` gates by caller (admin vs end-user), `scopes` gates by OAuth scope (`kb:read`, `crm:write`, etc.).
- Skill markdown under `<module>/skills/<slug>.md` is auto-loaded by `skill-loader.ts` and surfaced as MCP `resources/list` URIs (`skill://<module>/<slug>`).
- Tool + skill enforcement lives in `packages/mcp-toolkit/src/server.ts`. Scopes are intersected against `actor.scopes` at call time.
- The same `/mcp` serves admin agents (OAuth-authorized) and end-user agents (delegated tokens minted via `delegated-token.controller.ts`).

### Adding a new MCP tool — checklist

Tools are a public product surface and are reviewed for the Anthropic Software Directory (reviewers call every tool with valid params and scan its metadata). Keep new tools correct *and* compliant:

- **Pre-check DB constraints — don't rely on `try/catch`.** A handler runs inside the request's outer tenant transaction, so a unique/FK violation poisons that transaction and the *commit* fails **after** your handler returns — past any in-handler catch — surfacing as a bare `500`. Guard *before* the failing statement: `SELECT` for an existing row (unique), check referencing rows before a delete (FK `restrict`), confirm an FK target exists before insert/update — then `throw new ConflictException('<module>_conflict: …')` / `BadRequestException(...)`. Pattern: `crm_create_pipeline` (unique), `crm_delete_segment` (FK), `conv_assign_conversation` (FK target). Never return a generic 500 — reviewers reject them.
- **Never return `void`/`undefined` from a handler.** `JSON.stringify(undefined)` is `undefined`, which fails the MCP `CallToolResult` schema (`-32602`). Return a small object, e.g. `{ deleted: true, id }`. (Dispatch coalesces void → `null` as a backstop, but return something meaningful.)
- **Annotations are required:** `title` plus exactly one hint — `readOnlyHint: true` for reads, `destructiveHint: true` for anything that writes/updates/deletes (read-only tools auto-run; destructive tools always prompt). Tool `name` ≤ 64 chars.
- **Split read and write.** No tool that both reads and mutates, and no catch-all `method`-style param; keep `create` / `update` / `delete` as separate tools.
- **Description = what it does and when to use it**, matching actual behavior. Don't tell Claude how to behave, don't direct it to call other tools, no hidden/encoded instructions — those are auto-rejected as prompt-injection.
- **Zod input schema** for every input (drives validation + the published JSON schema); set `audiences` (admin vs end-user) and `scopes` (`<module>:read` / `<module>:write`).
- **DB touch?** migration + RLS policy + per-module SQL (see Conventions).
- **Test the conflict/validation paths, not just the happy path** (`*.test.ts` / `*.integration.test.ts`). To exercise the whole surface locally, drive `/mcp` with an admin key (`mn_admin_*`) over JSON-RPC and assert no `500`/`-32602`.

## Persistence

- Postgres + pgvector. Schema in `packages/db/src/schema.ts`, migrations in `packages/db/drizzle/`. RLS policies in `packages/db/src/sql/rls.sql` (one policy per table, gated by the `app.org_id` and `app.bypass_rls` GUCs that `TenancyInterceptor` sets per request).
- Application connects as the non-superuser `munin_app` role so RLS actually applies; superusers bypass RLS.
- All writes flow through the tenancy interceptor — never set GUCs by hand.

## Auth + tenancy

- BetterAuth for sessions + sign-in. OAuth 2.1 dynamic client registration via `@better-auth/oauth-provider`, MCP discovery via `OAuthResourceController` + the `/.well-known/oauth-*` endpoints.
- API keys (`mn_*`) for service-to-service and widget callers; their hashing is peppered by `MUNIN_KEY_PEPPER`.
- Secrets at rest (LLM API keys, IMAP/SMTP passwords, etc.) are pgcrypto-encrypted using `MUNIN_ENCRYPTION_KEY`. Encrypt/decrypt SQL lives in `@getmunin/core` (`encryptSecretSql` / `decryptSecretSql`).

## Conventions

- TypeScript strict everywhere. Path-style absolute imports inside packages.
- Branch names: `<type>/<kebab-summary>`, where `type` is one of `feat|fix|chore|docs|refactor|test|ci|perf|build|revert` (same set as Conventional Commits) — e.g. `feat/website-import-reconcile`, `fix/redos-tag-strip`, `chore/bump-getmunin-4.51.0`. Branch from `main`. Tool-generated branches (`changeset-release/main`) are exempt. Enforced by the `.husky/pre-push` hook.
- No comments unless they explain a non-obvious *why* (see global rules).
- Zod schemas for all MCP tool inputs and external boundaries.
- Tests live alongside source (`*.test.ts`, `*.integration.test.ts`). Integration tests gate on `TEST_DATABASE_URL`.
- New features that touch DB → migration + RLS policy + per-module SQL in `packages/db/src/sql/<module>.sql`.
- Migrations: `drizzle-kit generate` assigns a random `NNNN_adjective_noun` name — always rename the `.sql` file (and its `meta/NNNN_snapshot.json` + the `_journal.json` tag) to a meaningful `NNNN_<what_it_does>.sql`, e.g. `0048_cms_asset_references.sql`.
- Always smoke-test a migration against a throwaway local DB before opening the PR — especially any data backfill. Create a scratch DB on the local Postgres (`docker-postgres-1`), `MUNIN_MIGRATE_URL=… pnpm -F @getmunin/db db:migrate`, seed representative pre-existing rows, run the backfill, and assert the result. A backfill that only ran against an empty DB is untested. Note: data migrations that read FORCE-RLS tables must `set_config('app.bypass_rls','on',true)` — verify by querying as the non-superuser `munin_app` role (a superuser connection bypasses RLS and hides the bug).

## Common dev commands

```sh
pnpm install                                # workspace install
docker compose up                           # full stack (db + backend + web; agent runner runs in-process in backend)
pnpm dev                                    # run backend + web in dev mode
pnpm typecheck                              # workspace typecheck
pnpm -F @getmunin/backend-core test         # backend-core test suite (needs TEST_DATABASE_URL)
pnpm test:coverage                          # aggregated v8 coverage across all packages (needs TEST_DATABASE_URL); scope with a name, e.g. test:coverage backend-core
pnpm -F @getmunin/backend-core docs:generate # regen openapi.json + docs-fixtures
pnpm changeset                              # author a changeset before merging
```

## Testing /mcp against claude.ai (local server as a custom connector)

claude.ai custom connectors need OAuth discovery (`/.well-known/oauth-*`), dynamic client registration, the `/mcp` endpoint, and the login/consent pages all on **one public https origin**. Locally that means a path-routing proxy in front of backend (3001) + web (3000), exposed through a tunnel:

```sh
pnpm dev                                            # backend :3001 + web :3000
node scripts/claude-connector-proxy.mjs             # single origin on :8088
cloudflared tunnel --url http://localhost:8088      # prints https://<name>.trycloudflare.com
```

Then set in `.env` and restart the backend (it re-reads `.env` on every `--watch` restart; real env vars win over the file):

- `MUNIN_PUBLIC_URL=https://<tunnel>`
- `NEXT_PUBLIC_MCP_URL=https://<tunnel>/mcp` — drives the OAuth discovery documents.
- `NEXT_PUBLIC_AUTH_URL=https://<tunnel>` — **required, no path**. BetterAuth's baseUrl falls back to `NEXT_PUBLIC_MCP_URL`, and the `/mcp` path segment breaks its route matching: every `/auth/*` route 404s and claude.ai reports "Couldn't register with …'s sign-in service".
- `MUNIN_AUTH_TRUSTED_ORIGINS=…,https://<tunnel>`
- `MUNIN_INBOUND_POLL_WORKER_DISABLED=1` if you seed email channels without a real mailbox — the poll worker auto-deactivates channels after repeated failures, which then fails outreach approvals with `channel … is not active`.

The web dev server bakes `NEXT_PUBLIC_API_URL` into its bundles at compile time — if the login page shows "Couldn't reach the server", the web process was started with a stale value; restart it with `NEXT_PUBLIC_API_URL=http://localhost:3001`.

In claude.ai: Settings → Connectors → Add custom connector → `https://<tunnel>/mcp`, then sign in through the local dashboard when prompted. For headless smoke tests skip OAuth entirely: create an admin key (`mn_admin_*`) and drive `/mcp` over JSON-RPC with `Authorization: Bearer`.

MCP Apps (`ui://` panels) specifics:

- Hosts cache `ui://` resources **per URI** and tell the model "the widget rendered" even when the iframe stays blank — serve panels under content-addressed URIs (see `inspector.resource.ts`) so rebuilds bust the cache.
- An app that never completes `App.connect()` renders nothing, silently. Don't import the ext-apps SDK from esm.sh (its `zod/v4` shim drops named exports and the SDK throws at import time inside the iframe); bundle the SDK, or use jsdelivr `+esm` for inline spikes.
- Tool results over ~150k characters abort widget rendering — keep list-tool payloads bounded.
- Tools can declare `_meta: { ui: { visibility: ['app'] } }` to be callable **only from the panel** — Apps-capable hosts hide them from the model, so the action requires a human click (e.g. `outreach_approve_proposal`). This is host-enforced: hosts without MCP Apps still expose the tool normally, so keep `destructiveHint`, scopes, and service-level state checks as the real backstops. The panel and the model share one credential per session — scopes cannot separate them.

## Skill and task URI naming

Conventions for `skill://*` markdown under `packages/backend-core/src/modules/*/skills/` and `task://*` URIs in `packages/types/src/job-catalog.ts`.

### Slug

- **verb-object[-qualifier]**, lowercase, hyphen-separated.
- Imperative: `setup-email-channel`, `import-and-score-leads`, `publish-entry`, `escalate-to-human`.
- No vague nouns: `hygiene`, `curation`, `workflow`, `draft`, `onboarding` (use `clean-contact-data`, `review-content`, `publish-entry`, `draft-initial-email`, `create-first-space`).
- No module name in the slug — the path already namespaces it (`kb/curation` was redundant; `kb/review-content` is enough).
- Filename = `<slug>.md` and **must match** the URI segment. The loader derives the URI from the path: `<module>/skills/<slug>.md` → `skill://<module>/<slug>`.

### Title (frontmatter `title:`)

- Plain-English, task-shaped: "Set up an email channel", "Import and score leads", "Publish a CMS entry".
- Don't repeat the product name (`Munin`, `CMS`, `KB`, `CRM`) unless it disambiguates against a generic word ("Set up a chat widget" is fine; "CMS entry publish workflow" is not).
- Sentence-case, no trailing period.
- First H1 inside the body should match the title.

### Exception — `playbooks/*`

Playbooks are intentionally noun-led ("Customer acquisition", "Support desk launch", "Publish and distribute") — they name a packaged workflow rather than a single action. Keep that style.

### Renaming a slug

Code consumers of skill URIs live in:

- `packages/types/src/job-catalog.ts` — `KNOWN_SKILL_URIS`, `TIER_BY_URI`, `TOOL_PREFIXES_BY_URI`, and `WEB_SCRAPE_SITE_TASK_URI`.
- `packages/backend-core/src/modules/curator/curator-scheduler.service.ts` — scheduled `jobUri` constants.
- `packages/backend-core/src/modules/conv/conv.service.ts` — dispatch sites for draft / curation / extraction jobs.
- `packages/backend-core/src/modules/{kb,crm}/*.tools.ts` — `skill://...` references inside MCP tool descriptions.
- `packages/dashboard-pages/src/pages/ai-settings.tsx` and `packages/dashboard-pages/src/components/agent-config/website-import-card.tsx` — UI references.
- `packages/agent-runtime/src/*.test.ts` — fixtures.
- Cross-references in other `skills/*.md` files (`skill://<module>/<old-slug>` body links).

Persisted `curator_jobs.job_uri` rows need a `UPDATE … WHERE job_uri = '<old>'` migration alongside.

After renaming, regenerate fixtures with `pnpm -F @getmunin/backend-core docs:generate`.
