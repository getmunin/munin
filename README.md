# Munin

> Your whole customer operation, behind one MCP endpoint.

<p align="left">
  <a href="https://github.com/getmunin/munin/blob/main/LICENSE"><img src="https://img.shields.io/github/license/getmunin/munin?color=3fb950&labelColor=0F1419" alt="MIT License"></a>
  <a href="https://github.com/getmunin/munin/commits/main"><img src="https://img.shields.io/github/last-commit/getmunin/munin?color=3fb950&labelColor=0F1419" alt="Last commit"></a>
  <a href="https://registry.modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP%20Registry-com.getmunin%2Fmunin-0066FF?labelColor=0F1419" alt="Listed in the MCP Registry"></a>
</p>

<p align="left">
  <a href="https://www.getmunin.com"><b>Website</b></a> ·
  <a href="https://vimeo.com/1204180225?autoplay=0&utm_source=github&utm_medium=readme&utm_campaign=demo-video"><b>See it in action</b></a> ·
  <a href="https://www.getmunin.com/en/docs/"><b>Documentation</b></a> ·
  <a href="https://registry.modelcontextprotocol.io"><b>MCP Registry</b></a>
</p>

CRM, conversations, outreach, CMS, knowledge base, and analytics on one Postgres schema — exposed as MCP tools your agents drive, not screens you click through. Headless the way a headless CMS is: the dashboard owns settings, auth, and the human half of the work — an inbox where a person takes over a conversation, and a review queue where they approve what the agent proposed — but there is no admin UI to click your way through the data itself. Every action runs through MCP tools, callable from any MCP-compatible client (Claude, Cursor, ChatGPT, custom runners) — same tools, same permissions, same audit log, whether a human or an agent is driving. Munin even ships its own: an in-process, per-org agent runner that answers live conversations and works the curation queue against an LLM provider you configure — so the platform runs out of the box, with external MCP clients optional.

<p align="center">
  <img src=".github/assets/dashboard.png" alt="The Munin console — the inbox where a person takes over a conversation" width="100%"><br>
  <sub><b>The console</b> — settings, auth, the inbox, and the review queue. It drives the same MCP tools your agents call.</sub>
</p>

<p align="center">
  <img src=".github/assets/widget-demo.webp" alt="The Munin chat widget answering a customer from the knowledge base" width="420"><br>
  <sub><b>The embeddable chat widget</b> — answering a live customer from the knowledge base, ready to hand off to a human and be picked back up by the agent.</sub>
</p>

## Modules at a glance

| Module | Tools | What it does |
|---|---|---|
| Knowledge Base | `kb_*` | documents, hybrid search, audience scoping |
| Conversations | `conv_*` | channels, messages, handover |
| CRM | `crm_*` | contacts, companies, deals |
| CMS | `cms_*` | collections, entries, assets |
| Outreach | `outreach_*` | campaigns, drafts, propose-only |
| Analytics | `analytics_*` | page-view + search events |

These six modules aren't separate products — they share one Postgres schema, one permission model, and one audit log. Together with integrations and platform plumbing they add up to 223 MCP tools and 58 skills. Watch how they tie together:

<p align="center">
  <a href="https://vimeo.com/1202399440?autoplay=0&utm_source=github&utm_medium=readme&utm_campaign=promo-video">
    <img src=".github/assets/video-thumbnail.png" alt="Watch: what Munin is and how it works" width="100%">
  </a>
</p>

## Core modules

#### Knowledge Base
- Markdown articles organized into spaces, each scoped to the audiences allowed to see it.
- Hybrid search that blends keyword matching with meaning-based results.
- Website import — crawl a public site and turn each page into an article in the background, automatically dropping articles when their source page disappears.
- Full version history with restore, plus a review queue for proposed edits.
- Agents revise a long article in place with targeted text replacements, instead of rewriting the whole body to change a sentence.

#### Conversations
- One inbox across email, chat widget, voice (Threll.ai / Vapi), and SMS (Twilio / MessageBird).
- Inbound *and* outbound — agents answer conversations and can place outbound calls.
- Images in and out on every channel: customers send screenshots, operators and the agent reply with them, and the agent can see what it was sent.
- Email that behaves like email — start by forwarding to a generated address, quoted history reconstructed from Gmail, Outlook and Apple Mail replies, auto-replies and bounces filed away instead of queued, junk senders remembered, undelivered messages surfaced and retried.
- Per-topic reply automation: the agent starts out drafting for approval on a topic, and is promoted to sending on its own once you trust it there.
- Assignable, organized by topic, searchable across every message, and filterable by status, origin, channel, topic and age.
- Built-in handoff to a human, with notifications to your own systems as conversations change.

#### CRM
- Contacts, companies, deals, activities, pipelines, and segments.
- AI-written summaries and suggested next actions, kept separate from what people edit by hand.
- Consent tracking — the lawful basis and source for each contact, required before they can be added to any outreach — with address deliverability tracked separately, so a bounced address never reads as a withdrawn consent.
- Automatic duplicate detection that proposes merges for review, plus bulk contact import.

#### CMS
- Content collections with structured fields, and entries you can publish in multiple languages, each locale with its own slug.
- Rich content blocks for article bodies — callouts, quotes, media, and more — addressable by key, so an agent can add, replace, remove or reorder a single block.
- Scheduled publishing and a media library that keeps your master image and serves sized derivatives.
- Full version history with restore, search, and cross-references between entries.
- A public content API serves your site or app, with draft preview links for custom frontends and engagement tracking built into every entry.

#### Outreach
- Propose-only outbound across email, SMS, and voice calls — campaigns, segments, and drafts for both first touches and replies.
- Multi-step sequences with cadence rules that stop the moment someone replies.
- Every proposal reports the exact address or number an approval would reach, and an approved send can be scheduled rather than fired immediately.
- Outcomes extracted from replies and from finished calls, written back onto the record.
- Recipients are drawn only from contacts who have recorded consent (see CRM).
- Every message waits for human approval; nothing is ever sent automatically.

#### Analytics
- Captures page views and on-site searches across anything you want to measure, one row per view with read depth, reported per tracker.
- CMS pages are tracked automatically; for any other page, you add a small tracking snippet.
- Conversion funnels and per-visitor journeys — once someone is identified, their visits link to a CRM contact, including the anonymous ones from before. A signed email on identify means the website and the inbox resolve to one person.
- Breakdowns by traffic source, referrer, and country, plus "what to write next" signals (popular topics, engagement, and searches that came back empty).

## Integrations

Three kinds of integration, three homes. Which one you want depends on what the other system *is*.

#### Messaging channels — where customers write to you
Email over IMAP/SMTP, or a generated forwarding address you point your existing mailbox at. The embeddable chat widget, themeable and dark-mode aware, speaking 23 languages. Voice through Threll.ai or Vapi, SMS through Twilio or MessageBird. Each one is a channel adapter behind the same `conv_*` tools.

#### Operator bridges — where your team already works
Slack mirrors each conversation into a thread: your team replies from the thread and the customer receives it, outreach proposals arrive with approve and dismiss buttons, and CMS publishes are announced with a link to the live article. The conversation, the approval, and the audit entry are the same ones the dashboard shows.

#### Data connectors — your customers' systems of record
Read live over the vendor's API and never copied into Munin, so there is nothing to sync and nothing to go stale.

| Domain | Tools | Vendors |
|---|---|---|
| Commerce | `commerce_*` | Shopify, Magento 2 / Adobe Commerce |
| Bookings | `bookings_*` | Gastroplanner — availability, create, modify, cancel |
| Search Console | `seo_*` | Bing Webmaster Tools, Google Search Console |
| Anything proprietary | yours | any MCP server you run |

Commerce and bookings have a self-service half: an end-user agent in the chat widget looks up *their own* order or booking, bound to the caller's identity server-side rather than to whatever email the model was told. Search Console is operator-facing and admin-only. Connections are stored encrypted, authorize by API key or OAuth redirect depending on the vendor, and are managed from the dashboard's Integrations page.

Have a system no vendor adapter covers? Point Munin at an MCP server you run and its tools become connector tools, with per-connection allow-lists over which of them agents may call.

## Automation

#### Conversation loop
An in-process, per-org agent runner answers live conversations on every channel (chat widget, email, SMS, voice) against the LLM provider you configure — drafting and sending replies, and handing off to a human when needed.

#### Curator loop
The in-process agent runner also works a durable background job queue: scheduled KB curation, CRM hygiene, contact extraction, stale-content review, and outreach drafts, with retry and dead-letter handling.

#### Review
Everything an agent proposes and a person decides lands in one queue — KB revisions, outreach proposals, merge proposals, drafted replies — and every decision is kept, so the Decided feed is a durable record of who approved what, not a list that empties as you work it.

#### Playbooks & skills
Packaged markdown procedures (`skill://module/<verb-object>`) for multi-step, cross-module workflows, surfaced over MCP — followed both by Munin's own runner and by any external AI agent operating on the platform.

## Platform

#### Data portability
Symmetric `*_export` / `*_import` MCP tools (and `/v1/<module>/export|import` REST endpoints) per module, so an agent can move an org's data between a self-hosted server and the cloud in either direction. See `skill://playbooks/data-migration`.

#### Identity
One spine for the people on the other side of a conversation — a widget visitor, a caller's phone number, an email address, and your own system's user id resolving to the same person, addressable over MCP through `identity_*`.

#### Audit & webhooks
Every action is written to an audit log, and webhooks fan those events out to your own endpoints with signed, replayable deliveries.

#### Alerts & feedback
Operational issues surface as system alerts the agent can list, acknowledge, and resolve. An in-product feedback channel lets you file feature requests and vote on Munin's public roadmap.

#### Auth & access
Sign-in and access control run on BetterAuth, with OAuth 2.1 dynamic-client registration and team invites. Owners and admins reach the whole console; members reach the inbox and nothing else.

## See it in action

> Lovable builds your frontend. Munin spins up your operations. One prompt, one MCP endpoint — and the agents do the rest.

Watch Lovable build a real website from a single prompt while Munin stands up everything behind it — the CMS the blog reads from, a seeded knowledge base, analytics, and a chat widget that already knows the business. No click-ops, no screens to wire up; the agent does the work, over one MCP endpoint. Then a real customer conversation plays out: answered from the knowledge base, handed off to a human when it matters, and picked back up by the agent to close.

<p align="center">
  <a href="https://vimeo.com/1204180225?autoplay=0&utm_source=github&utm_medium=readme&utm_campaign=demo-video">
    <img src=".github/assets/demo-thumbnail.png" alt="Watch: Lovable builds the frontend while Munin stands up everything behind it" width="100%">
  </a>
</p>

## Two ways to run

**Self-host** (this repo): single-tenant, invite-only.

```bash
git clone https://github.com/getmunin/munin.git
cd munin
cp .env.example .env
docker compose up
```

Secrets left at their `.env.example` placeholders are auto-generated on first boot and persisted in the `munin-data` volume — fine for local self-hosting. For shared or production deployments, set strong `MUNIN_AUTH_SECRET` + `MUNIN_KEY_PEPPER` + `MUNIN_ENCRYPTION_KEY` values (`openssl rand -base64 48`) in `.env` instead.

The first user to sign up becomes the org admin; subsequent users need an invitation token or an email whose domain is in `MUNIN_ALLOWED_EMAIL_DOMAINS`.

**Hosted** (https://www.getmunin.com): multi-tenant, one signup per org.

## Try it locally

After `docker compose up`, the backend listens on `:3001` and the dashboard on `:3000`.

1. Open `http://localhost:3000` and register the first user — they become the singleton org admin.
2. In the dashboard, go to **Settings → API keys** and mint an admin key (`mn_admin_…`). Shown once; treat like a password.
3. Poke at the API and tools:

```sh
# REST control plane — direct, no OAuth
curl -s http://localhost:3001/v1/kb/spaces \
  -H "Authorization: Bearer mn_admin_..." | jq

# MCP tool browser (recommended for poking at tools/skills)
npx @modelcontextprotocol/inspector
# In its UI: URL = http://localhost:3001/mcp, Auth = Bearer mn_admin_...

# Raw curl over Streamable HTTP — useful for sanity-checking the transport
curl -N -X POST http://localhost:3001/mcp \
  -H "Authorization: Bearer mn_admin_..." \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The OpenAPI spec for the REST control plane is at `packages/backend-core/openapi.json`. To wire an MCP client like Claude or Cursor, see [Connect your AI agent](#connect-your-ai-agent) below.

## Connect your AI agent

Once you've signed up (hosted) or run `docker compose up` (self-host), point your MCP client at the URL — `http://localhost:3001/mcp` for self-host, or `https://mcp.getmunin.com` for hosted.

**Claude Code (CLI):**

```sh
claude mcp add munin http://localhost:3001/mcp
```

**Claude Desktop** — add to your MCP config:

```json
{
  "mcpServers": {
    "munin": {
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

The first call triggers an OAuth consent screen in your browser, then your agent has the full tool surface — Knowledge Base, Conversations, CRM, CMS, Outreach, Analytics, and whatever connectors you've wired up.

Belong to more than one org? Every org also has its own endpoint at `/mcp/o/<orgId>`. Connect to that URL and the client is pinned to that org for good, instead of following whichever org you last made active.

Hosts that support MCP Apps get more than text back: proposals, curation candidates and connector results render as interactive panels served as `ui://` resources, where a human clicks approve rather than asking the model to call the tool.

## Two trust contexts, one MCP endpoint

The same `/mcp` endpoint serves two distinct callers, audience-aware:

- **Admin agents** (Claude Desktop, Cursor, internal automation) — OAuth-authorized by you. Full tool surface, scope-gated per `kb:*`, `conv:*`, `crm:*`, `cms:*`, `outreach:*`, `analytics:*`, `commerce:read`, `bookings:*`, `seo:*`, `connectors:*`, `identity:read`, `slack:*`, `webhooks:*`.
- **End-user agents** (your voice AI, web chatbot, mobile app helper) — short-lived delegated tokens minted server-side from your backend, scoped to one of your end-users. Only self-service tools: read your own contact, send a message in your own conversation, look up your own order, make your own booking.

See `packages/backend-core/src/control/delegated-token.controller.ts` for the token-mint API. The `@getmunin/sdk` Node client wraps it.

Most of what these tools return is text nobody at your org wrote — inbound messages, CRM fields, imported articles, live records from a customer's store. Munin fences that content as data for its own runner, and tells external hosts the same thing in the server instructions; the real containment is still RLS, the audience gate, and per-skill tool allow-lists.

## Stack

| Layer | Tech |
|---|---|
| Language & runtime | TypeScript, Node 24 LTS |
| Monorepo | Turborepo, pnpm |
| Backend | NestJS |
| Frontend | Next.js |
| Data | Postgres + pgvector, Drizzle |
| Protocol & auth | MCP Streamable HTTP, BetterAuth + OAuth 2.1 |

## Documentation

Developer docs live at **[getmunin.com/docs](https://www.getmunin.com/en/docs/)** — guides, the REST API reference, the full MCP tool list, and the skill library.

## Contributing

Contributions are welcome. `pnpm install`, then `docker compose up` (or `pnpm dev`) gives you a full stack on `:3001` (backend) and `:3000` (dashboard). Branch from `main` as `<type>/<kebab-summary>` (e.g. `feat/website-import-reconcile`), keep PRs focused, and make sure CI (lint, typecheck, test, build) passes.

The screenshots above are generated, not hand-captured — see [`apps/web/capture/README.md`](./apps/web/capture/README.md) to regenerate them after a UI change.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, commit conventions, and PR guidelines.

## Security

Found a vulnerability? Please **don't** open a public issue — email **security@getmunin.com** instead. See [SECURITY.md](./SECURITY.md) for scope and our response timeline.

## License

MIT. See [LICENSE](./LICENSE).

Bundled third-party dependencies retain their own licenses — see [THIRD_PARTY_LICENSES.md](./THIRD_PARTY_LICENSES.md) (generated by `pnpm licenses:generate`, verified in CI).
