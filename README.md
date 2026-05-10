# Munin

> MCP-first headless business app suite. The agent is the UI.

Munin is an open-source business app suite (Knowledge Base, Conversations, CRM, CMS) where the only interface is via AI agents. There is no traditional admin UI for the apps themselves — agents bootstrap each app by asking you configuration questions in conversation.

**Status:** v0.4 in active development. Private during initial build; flips public at first release.

## What's in the box

- **Knowledge Base** — markdown documents, hybrid search (BM25 + pgvector embeddings)
- **Conversations** — multi-channel threads (email, voice, chat) routed through end-users, assignable, agent-resolvable
- **CRM** — contacts, companies, deals, activities, with relationship graph and AI-native fields
- **CMS** — agent-authored content collections with scheduled publishing and a public delivery API
- **Cross-cutting** — agent-driven feedback/voting, audit log, webhooks, team invites

## Two ways to run

**Self-host** (this repo): single-tenant, invite-only.
```bash
git clone https://github.com/getmunin/munin.git
cd munin
cp .env.example .env  # edit MUNIN_AUTH_SECRET + MUNIN_KEY_PEPPER
docker compose up
```
The first user to sign up becomes the org admin; subsequent users need an invitation token. Optional `MUNIN_ALLOWED_EMAIL_DOMAINS` allows a trusted-domain allowlist.

**Hosted** (https://getmunin.com): multi-tenant, one signup per org.

## Connect your AI agent

Once you've signed up (hosted) or run `docker compose up` (self-host), point your MCP client at the URL.

**Claude Desktop / Code** — add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "munin": {
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

(For the hosted version, swap in `https://mcp.getmunin.com`.) The first call triggers an OAuth consent screen in your browser, then your agent has the full tool surface (KB, conversations, CRM, CMS, suggestions).

## Two trust contexts, one MCP endpoint

The same `/mcp` endpoint serves two distinct callers, audience-aware:

- **Admin agents** (Claude Desktop, Cursor, internal automation) — OAuth-authorized by you. Full tool surface.
- **End-user agents** (your voice AI, web chatbot, mobile app helper) — short-lived delegated tokens minted server-side from your backend, scoped to one of your end-users. Only self-service tools (read your own contact, send a message in your own conversation).

See `packages/backend-core/src/control/delegated-token.controller.ts` for the token-mint API. The `@getmunin/sdk` Node client wraps it.

## Community ideas

Public ideas the community has voted on: https://getmunin.com/suggestions — agents file these via the `suggestion_create` MCP tool and orgs publish the ones worth sharing.

## Architecture sketch

- `apps/backend` — thin NestJS entry composing `@getmunin/backend-core` modules with single-tenant `AuthModule`. Exposes MCP server (Streamable HTTP), OAuth 2.1 server, and control-plane REST API on port 3001.
- `apps/web` — Next.js dashboard + landing on port 3000.
- `packages/backend-core` — every shared NestJS module (KB, conversations, CRM, CMS, suggestions, MCP, control plane, audit, tenancy, RLS, mailer, storage, webhooks, rate limit, quotas) plus `createApp` and the `createAuthController` helper. Cloud composes the same modules with multi-tenant auth.
- `packages/dashboard-pages` — dashboard page components shared between OSS and cloud webs.
- `packages/ui` — design-system primitives (shadcn-style).
- `packages/{core, db, types, sdk, mcp-toolkit, bootstrap}` — non-Nest building blocks (actor identity, schema, MCP toolkit, etc.)
- All `@getmunin/*` packages are published to GitHub Packages.

## Stack

TypeScript · Node 24 LTS · Turborepo · pnpm · NestJS · Next.js · Drizzle · Postgres + pgvector · MCP Streamable HTTP · BetterAuth

## License

MIT. See [LICENSE](./LICENSE).

---

This is alpha software in active development. APIs and schema may change.
