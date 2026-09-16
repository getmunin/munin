---
title: Playbook: Publish and distribute (CMS + KB + Conv)
description: Author content in the CMS, mirror the parts that should be searchable to the KB, and announce the publish to a conversation channel.
audiences: [admin]
---

# Publish and distribute (CMS + KB + Conv)

When a new piece of content goes live (product update, policy change, public-facing FAQ), three things should happen in lockstep: the canonical version publishes in the CMS, an agent-searchable copy goes into the KB, and a notification message lands in the right conversation channel.

This is a **playbook** — it composes per-module skills.

## TL;DR

1. Author + publish the entry per `skill://cms/publish-entry`.
2. Mirror to KB: `kb_create_document` with the entry's body in the appropriate space.
3. Announce in a conversation: `conv_send_message` to a designated internal channel (or per-customer channels for big news).

## Prerequisites

- The CMS collection and entry exist.
- The KB has a relevant space (`kb_list_spaces`); if not, run `skill://kb/create-first-space`.
- The conversation channel for announcements exists (`conv_list_channels`).

## Step 1 — author + publish in the CMS

Follow `skill://cms/publish-entry` end-to-end.

After it completes, you have:
- An entry with `status: 'published'` and a stamped `publishedAt`.
- The latest `version` number.
- A canonical URL the delivery API will serve from.

Read it back to capture the data you'll mirror:

```jsonc
{ "name": "cms_get_entry", "arguments": { "id": "<entryId>" } }
```

Hold onto the `data` payload — relevant fields are typically `title`, a public-facing summary or excerpt, and a slug for cross-linking.

If the entry is multi-locale, decide which locale you mirror to KB. The default locale is the safe default.

## Step 2 — mirror to KB

The CMS is the canonical source; the KB copy exists so agents can find it via `kb_search`. Don't try to keep them perfectly in sync — the KB copy is "good enough" search bait that points back to the CMS.

```jsonc
{
  "name": "kb_create_document",
  "arguments": {
    "spaceId": "<spaceId>",
    "title": "<entry.data.title>",
    "body": "<entry.data.title>\n\n<entry.data.summary or first ~500 words of body>\n\nFull article: <canonical CMS URL>",
    "tags": ["cms-mirror", "<collection-slug>", "<entry-slug>"],
    "public": true
  }
}
```

Conventions worth following:
- Tag the document with `cms-mirror` so it's distinguishable from native KB articles in audits.
- Include the canonical CMS URL at the bottom so an agent citing this article can link humans to the real version.
- Set `public: true` only if the underlying CMS entry is public.

If you're updating an already-published entry, the simplest pattern today is **delete + recreate** the KB mirror — `kb_create_document` doesn't have an upsert, and there's no built-in "get document by tag" lookup. Track the kb document id alongside the cms entry id in your own state if you want clean updates.

## Step 3 — announce it

There is no tool that opens a conversation, and no broadcast tool — nothing fans a message out to every thread. What you announce into depends on who the audience is.

**An existing thread.** If the announcement belongs in a conversation that already exists (a customer who asked for exactly this, an internal thread the team is using), post into it:

```jsonc
{
  "name": "conv_send_message",
  "arguments": {
    "conversationId": "<convId>",
    "body": "Just published: **<title>**\n\n<one-line summary>\n\nCMS: <canonical URL>\nKB mirror: <kb document id or search hint>"
  }
}
```

`internal: true` leaves it as a staff-only note on the thread instead of sending it to the customer.

**A list of customers.** That is outbound to people who didn't ask, so it runs through outreach — a campaign over the segment you want to reach, drafts filed per contact, and a human approving each one. Follow `skill://outreach/draft-first-touch-email`, then `skill://outreach/review-proposals`. The approval creates the conversation and sends; nothing leaves without it.

**The team.** If the Slack bridge is connected, operator-facing announcements belong there rather than in a customer channel — see `skill://slack/connect-slack`.

## Step 4 — verify

```jsonc
{ "name": "kb_search", "arguments": { "query": "<title>", "limit": 5 } }
```

The mirrored doc should surface within ~5 seconds (embedding pipeline is async).

```jsonc
{ "name": "cms_search_entries", "arguments": { "query": "<title>", "limit": 5 } }
```

The published entry should be there too. If both surface and the announcement was sent, the publish + distribute step is complete.

## What NOT to do

- **Don't try to make the KB copy authoritative.** The CMS is the source of truth. The KB copy is search bait; it can drift, that's fine.
- **Don't mirror long-form articles verbatim into KB.** Embeddings and FTS work better with concise, focused chunks. Either summarize, or split by H2 per `skill://kb/import-from-google-docs`.
- **Don't broadcast announcements by sending into every customer's conversation.** There's no "broadcast" primitive; fan-out is opt-in by your script. Decide explicitly which conversations receive the message.
- **Don't update the KB mirror in place by re-using the same doc id.** Today the cleanest path is delete + recreate (or just create a new mirror and let the old one age out via tag).

## Related

- `skill://cms/publish-entry` — the publish half.
- `skill://kb/import-articles-in-bulk` — bulk mirroring for catch-up imports.
- `skill://conv/setup-email-and-widget-channels` — making sure the announcement channel exists.
- `skill://analytics/track-website-traffic` — measure which published entries actually get read; feed that signal back into the next quarter's review.
