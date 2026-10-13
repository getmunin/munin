---
title: Serve several sites from one organization
description: Run one support agent across several websites — one chat widget per site, a per-channel descriptor naming the site, each site's KB space and store connection pinned to its channel so answers never cross over.
audiences: [admin]
---

# Serve several sites from one organization

Some orgs run several shops or brands from one Munin org — say Acme and Globex, each with its own website, its own policies and its own store in a shared Magento install. One support agent answers on both, so it needs to know which site a conversation came from and must not answer an Acme customer from Globex's return policy or Globex's orders.

Three layers do that. Set up all three; they reinforce each other.

| Layer | What it does | Enforced by |
|---|---|---|
| Per-channel descriptor | Tells the agent which site it is answering for | The prompt |
| Channel KB spaces | The agent can only search and read that site's documents | Row-level security |
| Channel connections | Order and booking lookups always hit that site's store | `resolveScope` on the server |

The descriptor shapes what the agent says; the other two decide what it can reach. Don't rely on the descriptor alone — a prompt is guidance, the bindings are hard limits.

## 1. One channel per site

Give each site its own chat widget (`skill://conv/setup-chat-widget`), e.g. `Acme chat` and `Globex chat`, each with that site's origin in `originAllowlist`. The same works for email, SMS and voice channels — every channel kind can carry the bindings below. Note the channel ids from `conv_list_channels`.

## 2. Describe each channel

The support agent's prompt already contains a descriptor per channel *type* (`channel-chat`, `channel-email`, `channel-sms`, … in the `agent-runtime` KB space). On top of that it reads a descriptor per *channel*: a document in the same space whose slug is `channel-` followed by the channel id with `_` replaced by `-`. Channel `cch_abc123` reads `channel-cch-abc123`.

```jsonc
// kb_list_spaces → the id of the space with slug "agent-runtime"
{
  "name": "kb_create_document",
  "arguments": {
    "spaceId": "<agent-runtime space id>",
    "slug": "channel-cch-abc123",
    "title": "Channel: Acme chat",
    "body": "You answer for Acme (acme.example). Only discuss Acme's products, prices, delivery and return terms. If the customer asks about Globex, say this chat is for Acme and point them to globex.example."
  }
}
```

The agent sees the channel's name and id in a `[Channel]` block, followed by this text, after the channel-type descriptor — so the per-channel document only needs what is specific to the site, not chat formatting rules. Edits, new documents and deletions take effect within seconds; no restart. Leave the audience at the default `admin`: this is configuration, not customer-facing content.

## 3. Pin each site's knowledge base

Put each site's documents in a KB space of its own (`acme`, `globex`). Documents both sites share go in a third space (`shared`) that both channels include.

```jsonc
{
  "name": "conv_set_channel_sources",
  "arguments": {
    "channelId": "<Acme chat id>",
    "kbSpaceIds": ["<acme space id>", "<shared space id>"]
  }
}
```

From then on, in conversations from that channel, `kb_search`, `kb_get_document` and the other KB reads only return self-service documents in those spaces. The filter is applied by row-level security, so it holds whatever query the agent makes. Teammates and admin agents still see everything.

`kb_import_website` has no space option: every import, for every site, writes into the one `website-import` space. So with channel KB spaces, put each site's documents in its own space with `kb_create_document` (or `kb_import` for a bulk file) rather than relying on website imports. Leave `website-import` out of a channel's list unless its pages really apply to that site, because one site's imported pages are otherwise searchable from the other site's channel. When you do import a second site's pages, pass `synthesizeCompanyProfile: false`, or the import overwrites the org's company profile with that site's.

## 4. Pin each site's store

For a shared Magento install, create one connection per site with that site's `storeCode` (`skill://connectors/connect-external-system`, *One Magento install, several sites*). Separate Shopify stores or Gastroplanner restaurants are just separate connections. Then pin them:

```jsonc
{
  "name": "conv_set_channel_sources",
  "arguments": {
    "channelId": "<Acme chat id>",
    "connectionIds": ["<Acme store connection id>", "<Acme bookings connection id>"]
  }
}
```

A channel takes at most one commerce and one bookings connection. In that channel's conversations the commerce and bookings tools use the pinned connection without the agent passing `connectionId`, and a call naming a different connection is refused. Search-console (`seo`) connections are operator-only and can't be pinned.

A pinned connection can't be deleted (`connectors_connection_bound`) until it is removed from its channels. Deactivating it makes that channel's lookups fail rather than fall back to another store.

## In the dashboard

A teammate can do steps 3 and 4 without an agent: **Channels** → **Edit** on the channel (or **Add channel**) → the **Knowledge** tab. Switch the knowledge base to *Only these* and tick the spaces, then switch Store and Bookings to *Only one* and pick the connection. Each card shows its channel's spaces and pinned connections. The per-channel descriptor in step 2 is still a KB document.

## Checking and undoing

`conv_get_channel_sources` shows a channel's spaces and connections. In `conv_set_channel_sources`, each list replaces the current one, an omitted list is left alone, and an empty list removes that restriction:

```jsonc
{ "name": "conv_set_channel_sources", "arguments": { "channelId": "<id>", "kbSpaceIds": [] } }
```

## What the bindings do not cover

- **Teammates and admin agents.** Someone working the inbox can search every space and pick any connection — that's deliberate.
- **Customers' own agents with delegated tokens.** A token minted through `POST /v1/tokens/delegated` is not tied to a conversation, so it gets the org-wide view. The bindings apply to Munin's support agent and to voice tool calls on a channel's conversations.
- **Company profile.** The `website-import/company-profile` document is org-wide and goes into every conversation's prompt. With several sites, keep it about the company as a whole and put site specifics in the per-channel descriptors.
