---
title: 'Connectors: Connect a custom MCP server'
description: Give the support agent live read access to a system Munin has no vendor adapter for — a proprietary CRM, a subscription database, an internal API — by pointing Munin at an MCP server the customer hosts. Covers the setup flow, the server contract (bearer auth + signed identity assertions), and a reference implementation to hand to the customer's developers.
audiences: [admin]
---

# Connect a custom MCP server

Shopify, Magento and Gastroplanner have built-in adapters. For everything else — a proprietary CRM, a billing system, a members database — the org can host a small **MCP server** in front of their system and connect it with the `custom-mcp` vendor. While the Munin agent handles a conversation, the remote server's tools appear alongside the built-in ones (namespaced `ext_<connection>_*`), so the agent can answer "what subscriptions do I have?" from the org's own system of record, live. Nothing from the remote system is persisted in Munin.

## TL;DR — connecting (agent side)

1. The org's developers stand up an MCP server (contract below) and mint a bearer token for Munin.
2. `connectors_create_connection` with `vendor: "custom-mcp"`, a `name`, and `config: { "url": "https://api.example.com/mcp" }`. The name becomes the tool namespace — "Legacy CRM" → `ext_legacy_crm_*` — so keep it short and stable; renaming the connection renames the tools.
3. Share the returned one-time credential link — a human enters the bearer token in the dashboard. **Never accept the token in chat**; the tool rejects secret fields.
4. `connectors_test_connection` — connects to the server and lists its tools.
5. Done. The in-house agent picks the tools up on the next conversation turn. If the server is down, the agent simply runs without those tools — a broken connector never breaks the conversation.

Multiple custom servers can coexist; each connection gets its own namespace. Deactivate with `connectors_update_connection { active: false }`.

## The server contract (customer side)

The server implements standard MCP over **streamable HTTP** (single endpoint, JSON-RPC POST). Any MCP SDK works. Four rules make it safe:

### 1. Authenticate Munin with the bearer token

Every request carries `Authorization: Bearer <token>` — the token the org minted and entered through the credential link. Reject requests without it. Rotate by deleting and recreating the connection.

### 2. Identity arrives out-of-band — tools take no identity parameters

This is the load-bearing rule. Tools like `list_subscriptions` must **not** take an `email` or `customerId` argument — a parameter is something a confused or manipulated model could fill with someone else's identity. Instead, every call from Munin carries an `X-Munin-Identity` header: a short-lived JWT (ES256, ~5 min) identifying the end-user the agent is currently serving.

```json
{
  "iss": "{{API_URL}}",
  "sub": "eu_01hq3…",
  "aud": "https://api.example.com/mcp",
  "org_id": "{{ORG_ID}}",
  "email": "jane@example.com",
  "email_verified": true,
  "phone": "+4712345678",
  "phone_verified": true,
  "name": "Jane",
  "iat": 1755772800,
  "exp": 1755773100,
  "jti": "…"
}
```

Verify it against the org's JWKS document — public, no auth:

    GET {{API_URL}}/v1/public/connectors/{{ORG_ID}}/jwks

Check the signature, `iss`, `aud` (must be the server's own URL), and `exp`, then scope every answer to the identified person. `email_verified: false` means the address was self-reported in a chat widget and never authenticated — treat it as untrusted: return nothing personal, or only what you'd show an anonymous visitor. The same applies to `phone_verified`.

A request with no valid `X-Munin-Identity` header should still answer tools that need no identity (product catalogs, opening hours) and refuse personal lookups.

### 3. Keep the tool surface small and honest

- Munin exposes at most **20 tools per connection**; extras are dropped.
- Tool names ≤ ~40 chars (the `ext_<connection>_` prefix must fit inside MCP's 64-char limit).
- Descriptions describe what the tool does — they are shown to a language model, so anything phrased as an instruction ("always call this first", "ignore other results") gets a connection rejected at review. Munin also sanitizes and truncates descriptions defensively.
- Read-only by design. Munin's agent treats these tools as lookups; don't expose mutations unless the org explicitly wants the agent acting on their system.

### 4. Answer fast

Tool calls happen while a customer is waiting on a reply. Munin abandons a connection attempt after 5 seconds and individual calls after 10. Target well under a second; return compact JSON (the whole result is fed to a model — kilobytes, not megabytes).

## Reference implementation

A complete server in ~80 lines with the official TypeScript SDK — hand this to the org's developers as the starting point:

```ts
import express from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { McpServer } from '@modelcontextprotocol/server';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/server/streamableHttp.js';
import { z } from 'zod';

const MUNIN_JWKS = createRemoteJWKSet(
  new URL('{{API_URL}}/v1/public/connectors/{{ORG_ID}}/jwks'),
);
const SELF_URL = 'https://api.example.com/mcp';
const MUNIN_TOKEN = process.env.MUNIN_BEARER_TOKEN!;

interface CallerIdentity {
  email: string | null;
  verified: boolean;
}

async function identify(header: string | undefined): Promise<CallerIdentity> {
  if (!header) return { email: null, verified: false };
  const { payload } = await jwtVerify(header, MUNIN_JWKS, {
    issuer: '{{API_URL}}',
    audience: SELF_URL,
  });
  return {
    email: typeof payload.email === 'string' ? payload.email : null,
    verified: payload.email_verified === true,
  };
}

function buildServer(caller: CallerIdentity): McpServer {
  const server = new McpServer({ name: 'example-crm', version: '1.0.0' });
  server.registerTool(
    'list_subscriptions',
    {
      description: "The signed-in customer's active and past subscriptions.",
      inputSchema: { limit: z.number().int().min(1).max(25).default(10) },
    },
    async ({ limit }) => {
      if (!caller.email || !caller.verified) {
        return {
          content: [{ type: 'text', text: 'No verified customer identity on this conversation.' }],
        };
      }
      const rows = await crmDb.subscriptionsByEmail(caller.email, limit);
      return { content: [{ type: 'text', text: JSON.stringify(rows) }] };
    },
  );
  return server;
}

const app = express();
app.post('/mcp', express.json(), async (req, res) => {
  if (req.headers.authorization !== `Bearer ${MUNIN_TOKEN}`) {
    return res.status(401).end();
  }
  const caller = await identify(req.header('x-munin-identity')).catch(() => ({
    email: null,
    verified: false,
  }));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = buildServer(caller);
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
app.listen(3100);
```

The pattern to copy: authenticate the bearer token, verify the identity assertion, and resolve *who* server-side — the tool argument surface never mentions identity.

## How identity gets its trust

The email in the assertion is the one on the Munin end-user record, and it is only marked verified when it arrived through an authenticated path — the customer wrote in from that mailbox, or the org's own backend minted a delegated token after logging them in (`skill://connectors/connect-external-system` explains that chain). An address merely *typed into the chat widget* comes through as `email_verified: false`. The customer's server makes the final call, but Munin never asserts an identity it hasn't seen evidence for.

## What this is not

- **Not a sync.** Munin stores the connection (URL + encrypted token) and nothing else. No contact import, no mirroring, no webhooks.
- **Not on the public `/mcp` surface.** Remote tools are composed into the org's own in-house agent runs; they are not re-exported to external MCP hosts connecting to Munin.
- **Not a way around scopes.** Remote tools carry no Munin scopes; RLS, audiences, and the per-connection bearer token stay the containment. Tool *results* from the remote server are fenced as untrusted data in the agent's context, like every other third-party text.
