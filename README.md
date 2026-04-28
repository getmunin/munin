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
