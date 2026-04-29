# Munin

> MCP-first headless business app suite. The agent is the UI.

Munin is an open-source business app suite (Knowledge Base, Helpdesk, CRM) where the only interface is via AI agents. There is no traditional admin UI for the apps themselves — agents bootstrap each app by asking you configuration questions in conversation.

**Status:** v0.4 in active development. Private during initial build; flips public at first release.

## What's in the box

- **Knowledge Base** — markdown documents, hybrid search (BM25 + pgvector embeddings)
- **Helpdesk** — conversation-first (not ticket-first), multi-channel (email, voice, chat)
- **CRM** — contacts, companies, deals, activities, with relationship graph and AI-native fields
- **Cross-cutting** — agent-driven feedback/voting, audit log, webhooks, partner provisioning

## Two ways to run

**Self-host** (this repo):
```bash
git clone https://github.com/munin-dev/munin.git
cd munin
docker compose up
```

**Hosted** (https://getmunin.com): one signup, no install. Free tier available.

## Connect your AI agent

Once you've signed up (hosted) or run `docker compose up` (self-host), point your MCP client at the URL.

**Claude Desktop / Code** — add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "munin": {
      "url": "https://mcp.getmunin.com"
    }
  }
}
```

For self-host, swap in `http://localhost:3001/mcp`. The first call triggers an OAuth consent screen in your browser, then your agent has the full tool surface (KB, helpdesk, CRM, suggestions).

## Two trust contexts, one MCP endpoint

The same `mcp.getmunin.com` URL serves two distinct callers, audience-aware:

- **Admin agents** (Claude Desktop, Cursor, internal automation) — OAuth-authorized by you. Full tool surface.
- **End-user agents** (your voice AI, web chatbot, mobile app helper) — short-lived delegated tokens minted server-side from your backend, scoped to one of your end-users. Only self-service tools (read your own contact, send a message in your own ticket).

See `apps/backend/src/control/delegated-token.controller.ts` for the token-mint API. The `@getmunin/sdk` Node client wraps it.

## Community ideas

Public ideas the community has voted on: https://getmunin.com/suggestions — agents file these via the `suggestion_create` MCP tool and orgs publish the ones worth sharing.

## Architecture sketch

- `apps/backend` — NestJS app exposing MCP server (Streamable HTTP), OAuth 2.1 server, and control-plane REST API
- `apps/web` — Next.js dashboard + landing
- `packages/{core, db, mcp-toolkit, bootstrap, sdk, types}` — shared building blocks

## Stack

TypeScript · Node 24 LTS · Turborepo · pnpm · NestJS · Next.js · Drizzle · Postgres + pgvector · MCP Streamable HTTP · BetterAuth · Scaleway (hosted)

## License

MIT. See [LICENSE](./LICENSE).

---

This is alpha software in active development. APIs and schema may change.
