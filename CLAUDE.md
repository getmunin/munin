# Munin — agent guide

MCP-first customer platform made for the agentic era (KB, Conversations, CRM, CMS, Outreach). The agent is the UI: every action runs through MCP tools served at `/mcp`. There is no admin REST API for app data — the dashboard at `apps/web` is a thin shell that drives the same MCP endpoint.

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
