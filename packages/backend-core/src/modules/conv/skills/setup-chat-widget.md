---
title: Conv: Set up a chat widget
description: Provision a per-channel widget API key, push transcripts via POST /v1/widget/messages, and wire the human-handoff webhook.
audiences: [admin]
---

# Set up a chat widget
Lets an external AI agent running as a chat widget on a customer's website push transcripts into Munin's conversation module. Once the conversation is in Munin, a human in the dashboard can reply, and the customer's webhook receiver tells the external agent to step back.

## 1. Create the channel and mint a widget key

Call `conv_create_widget_channel`:

```jsonc
{
  "name": "storefront-bot",
  "originAllowlist": ["https://customer.example"]
}
```

Response includes `widgetKey: "mn_widget_…"` — shown once. Store it server-side.

`originAllowlist` is required — the widget ingest endpoint rejects any request whose `Origin` header doesn't match one of the listed full origins (scheme + host + port, exact match). List every environment that should be allowed to ingest (`https://customer.example`, `https://staging.customer.example`, etc.).

The widget key is bound to this channel via `api_keys.channel_id`. Rotate with `conv_rotate_widget_key`; update origins with `conv_update_widget_channel`.

### Appearance attributes on the drop-in embed

If the customer uses Munin's own `widget.js` bundle rather than their own chat UI, these optional `data-*` attributes on the script tag configure it. Add them only when the operator asked for that look.

| Attribute | Values | Effect |
|---|---|---|
| `data-munin-fonts` | `bundled` (default), `inherit` | `bundled` ships subset Instrument Serif + JetBrains Mono (~60 KB) and matches the dashboard typography. `inherit` downloads no fonts and renders every string in whatever `font-family` the page applies to `<body>`, so the panel blends into the site's type stack. Sizes, weights and italics are unchanged either way. |
| `data-munin-theme-color` | hex, e.g. `#0066FF` | Accent for the unread badge, send button, links and visitor bubbles. Text on top of it flips between ink and paper for contrast. |
| `data-munin-launcher-color` | hex | Fill of the round launcher bubble. Defaults to the near-black ink of the panel header, so a brand-colored bubble is an explicit opt-in; the glyph inside follows for contrast. |
| `data-munin-launcher-icon-color` | hex | Color of the chat glyph in the launcher, overriding the automatic contrast pick. |
| `data-munin-header-color` | hex | Fill of the panel's top bar (org name + close button). Defaults to the same near-black chrome as the launcher; the text/icon color picks whichever of ink/paper contrasts better. |
| `data-munin-position` | `bottom-right` (default), `bottom-left` | Launcher corner. |
| `data-munin-size` | `compact`, `standard` (default), `generous` | Panel size. |
| `data-munin-org-name` | free text | Header title. Defaults to "Chat". |
| `data-munin-eyebrow` | free text | Small uppercase label above the greeting. |
| `data-munin-greeting` | free text | Welcome line; the widget renders everything after the first sentence in serif italic and a softer ink tone. Set the `--munin-greeting-emphasis` custom property to `normal` on the embed host for an upright second clause (see below). |
| `data-munin-locale` | BCP-47 tag | Forces the widget's UI language instead of negotiating from the browser. |
| `data-munin-color-scheme` | `auto` (default), `light`, `dark` | `auto` follows the visitor's OS/browser preference (`prefers-color-scheme`) and updates live if they switch it; `light`/`dark` pins the panel regardless of OS setting. The launcher bubble, header bar and voice-call screen stay their fixed near-black chrome in every mode unless overridden by the color attributes above — only the panel body (welcome/chat/composer/cards) inverts. |
| `data-munin-show-history` | `true` (default), `false` | Whether past conversations are listed on the welcome screen. |

An unrecognized value is a console warning, not an error — the widget falls back to the default and still mounts.

### Visitor attributes on the drop-in embed

The same bundle accepts a visitor profile, which lands on the contact row the first time the session ingests. Render these for signed-in users on a server-rendered page — they are the embed-side equivalent of the `visitor` object in §2's server-to-server payload.

| Attribute | Effect |
|---|---|
| `data-munin-visitor-name` | Display name, trimmed and truncated to 120 chars. |
| `data-munin-visitor-email` | Email address, format-checked client-side and re-validated server-side. An invalid value is dropped with a console warning rather than sent. |
| `data-munin-visitor-meta` | Flat JSON object of string / number / boolean values, max 4 KB, e.g. `'{"plan":"pro","accountId":"acc_42"}'`. Lands on `conv_contacts.metadata`. Nested values are dropped with a warning. |
| `data-munin-meta-<key>` | Shorthand for a single metadata entry; the key is camelized (`data-munin-meta-account-id` → `accountId`). Merged with `data-munin-visitor-meta`, which wins on a key collision. |

**Send a name whenever you have one.** Identity verification (§4) binds a session to an `externalId` and nothing else — it carries no name and no email — so a verified visitor with no `data-munin-visitor-name` still has an unnamed contact row. Every surface that displays a customer falls back through name → email → phone, so without a name the dashboard, the Slack mirror and outreach all show a raw email address, or a generic placeholder when there is no email either.

These are unrelated to `data-external-id` / `data-user-hash`: the visitor attributes are unverified page-supplied claims, useful for display, while identity verification is what actually authenticates the session. Sending both is the normal case for a signed-in user.

### Overriding styles from the page

The panel renders inside a shadow root, so the site's own stylesheets cannot reach its internals — but CSS custom properties do inherit across the shadow boundary. Set them on the widget host element from an ordinary page stylesheet:

```css
[data-munin-widget] {
  --munin-greeting-emphasis: normal;
}
```

`--munin-greeting-emphasis` styles the part of the greeting after the first sentence; it takes any `font-style` value and defaults to `italic`. This is the only supported way to restyle panel internals — reaching into `.shadowRoot` from JavaScript depends on class names that change between releases.

### Programmatic open/close

Once the widget script has executed, `window.mn.widget` exposes:

```ts
window.mn.widget.open();     // opens the panel
window.mn.widget.close();    // closes the panel
window.mn.widget.toggle();   // flips it
window.mn.widget.isOpen();   // current state, boolean
window.mn.widget.ready;      // true once the namespace is installed
await window.mn.widget.identify(externalId, userHash);  // see §4
```

Wire a "Chat with us" link anywhere in the page's own nav/footer to `window.mn.widget.toggle()` instead of relying on the launcher bubble alone. Because the script tag has `defer`, `window.mn.widget` isn't installed until after the page has parsed — safe to call from a click handler, not safe to call synchronously in an inline `<script>` above the widget tag.

For code that must run as soon as the widget is usable — an `identify` call on a freshly signed-in SPA, say — gate on the namespace rather than polling. The widget dispatches `munin:widget-ready` on `document` once it mounts:

```js
const go = () => window.mn.widget.identify(externalId, userHash);

window.mn?.widget?.ready
  ? go()
  : document.addEventListener('munin:widget-ready', go, { once: true });
```

The flag closes the listener-attached-too-late race: if the widget mounted before your code ran, the event has already fired, but the flag says it is safe to call now. (`munin:widget-ready` is the widget's own signal — the analytics tracker fires `munin:analytics-ready` separately.)

`window.mn.widget` is a single global, so on a page with two widget embeds it stays bound to whichever mounted **first** and the second logs a warning. Don't rely on it when you deliberately run two channels on one page — drive those from their own launchers.

## 2. Push transcripts from the agent

`POST /v1/widget/messages` — server-to-server is the recommended integration so the key never reaches browser JS.

```bash
curl -sS https://munin.example/v1/widget/messages \
  -H "Authorization: Bearer $MUNIN_WIDGET_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "channelId": "cch_…",
    "sessionId": "vis_abc123",
    "visitor": { "name": "Vita", "email": "vita@example.com" },
    "url": "https://customer.example/checkout",
    "messages": [
      { "role": "end_user", "body": "Where is my order?", "providerMessageId": "evt_1" },
      { "role": "agent",     "body": "Let me check…",      "providerMessageId": "evt_2" }
    ]
  }'
```

Response: `{ conversationId, displayId, contactId, inserted, skipped }`.

### Conversation upsert

Conversations are keyed by `(orgId, channelId, metadata.sessionId)`. Sending the same `sessionId` again appends to the existing conversation; a new `sessionId` opens a new one.

### Idempotency

If you set `providerMessageId` on a message, replays of the same identifier are silently skipped (counted as `skipped`). Without `providerMessageId`, every POST inserts new rows — that's by design (the agent opts into idempotency by including the field).

### Visitor enrichment

`visitor.email` enables CRM linkage: the contact is matched on (org, email). If you don't have an email, the contact is matched on `metadata.sessionId` so re-pushes update the same row. Once the visitor identifies themselves, send the email — the existing contact gets enriched rather than duplicated.

Send `visitor.name` too whenever you know it. It is what every customer-facing surface displays first, and no other part of the pipeline can infer it — see the note under §1's visitor attributes. On the drop-in embed, the same three fields are `data-munin-visitor-name` / `-email` / `-meta`.

## 3. Receive replies from a human / Munin agent

When a Munin user replies in the conversation UI, `conversation.message.sent` fires on every webhook subscribed to that event. Subscribe your endpoint and:

1. Fetch the message via the standard `conv_get_conversation` tool.
2. Render it in the customer-side widget UI.
3. Optionally signal your AI to step back so the human owns the thread.

Same webhook surface used elsewhere in Munin — no widget-specific events.

## 4. Verified identity (optional)

By default widget visitors are anonymous — contacts are keyed on `metadata.sessionId` (or `visitor.email` if sent). To tie a widget session to a *known* user (and gate anonymous access), attach a signed identity: a `verifiedExternalId` + `userHash` pair the ingest endpoint verifies against the channel's identity-verification secret.

`conv_create_widget_channel` returns `identityVerificationSecret` once (alongside `widgetKey`). Treat it like an OAuth client secret — store it server-side, never embed it in browser JS. Rotate with `conv_rotate_widget_identity_secret` (previously-issued hashes stop verifying immediately). This is a **separate secret from the analytics tracker's** — sign widget hashes with the widget channel's secret, never the tracker secret.

Compute the hash server-side:

```ts
import { createHmac } from 'node:crypto';

function userHash(externalId: string, secret: string): string {
  return createHmac('sha256', secret).update(externalId).digest('hex');
}
```

The widget hash covers `externalId` **only** — no visitor binding. That's a deliberate contrast with the analytics tracker, whose identify hash binds the visitor and the email (a length-prefixed `mn.identity.v1` payload, see `skill://analytics/identify-visitors`) and therefore needs a per-session browser round-trip. Because the widget hash is static per user, you can **server-render it** into the embed with no round-trip:

```html
<script async
  src="https://munin.example/widget.js"
  data-widget-key="mn_widget_…"
  data-channel-id="cch_…"
  data-external-id="user_42"
  data-user-hash="<hex hmac from above>">
</script>
```

`data-external-id` and `data-user-hash` are all-or-nothing: sending one without the other is rejected (`identity_partial`). Render them only for signed-in users; omit both for anonymous visitors. (On browser-direct calls, the same values are passed as the `verifiedExternalId` + `userHash` params.)

Set `requireVerifiedIdentity: true` on the channel (`conv_create_widget_channel` / `conv_update_widget_channel`) to reject unverified sessions outright; the default (`false`) allows anonymous ingest alongside verified ones.

Because the widget and the analytics tracker share the same `localStorage` visitor id (`mn.vid`), identifying a visitor to the widget also stitches their prior anonymous analytics history — no separate `window.mn.analytics.identify` call needed for that visitor.

### Running the widget and the analytics tracker on the same page

Both bundles hang off `window.mn`, but each owns its own namespace — `mn.widget` and `mn.analytics` — so nothing collides. A page running both identifies each surface explicitly:

```js
window.mn.widget.identify(externalId, widgetHash);                 // externalId-only hash
window.mn.analytics.identify(externalId, trackerHash, { email });  // visitor-bound hash
```

They take **different hashes signed with different secrets** (see the contrast above), so passing the same value to both will fail one of them. On a server-rendered page, drop the first call and use `data-external-id` + `data-user-hash` on the embed instead.

`window.mn.widget.identify` earns its keep on an SPA that signs a user in without a reload: the widget has already mounted anonymously, and this is the call that claims that anonymous chat session — transcript and all — for the now-known user.

**Migrating from 4.x:** the widget's `identify` used to sit on the shared root as `window.mn.identify`, where it chained with the tracker's identically-named call and one of the two always rejected the hash it received. It is now `window.mn.widget.identify`.

### Sharing a session across subdomains

The visitor id and session id live in `localStorage` (with a cookie fallback), both scoped to the exact host by default. A conversation started on `www.example.com` therefore does **not** carry over to `app.example.com`. To share one thread across sibling subdomains — e.g. an anonymous chat on the marketing site that continues (and gets claimed) once the visitor signs in on the app — set `data-munin-cookie-domain` to a shared parent domain on every embed:

```html
<script async
  src="https://munin.example/widget.js"
  data-widget-key="mn_widget_…"
  data-channel-id="cch_…"
  data-munin-cookie-domain=".example.com">
</script>
```

The session + visitor cookies are then written with that `Domain`, so both subdomains read the same ids and the anonymous thread is claimed on identify. The value must be a suffix of the current host (`.example.com` on `app.example.com`); anything else is ignored client-side to avoid the browser silently dropping the cookie.

## 5. Browser-direct integration (less secure)

If you must call the endpoint from browser JS, the channel's `originAllowlist` reflects allowed `Origin` headers and the endpoint sets the matching `Access-Control-Allow-Origin`. Anyone on a listed origin can use the key; rotation is one tool call. Server-side is strongly preferred.

## 6. Operations

| Task | How |
|---|---|
| Disable the channel | Set `conv_channels.active=false`. Existing keys still auth but ingest returns 403. |
| Rotate the widget key | `conv_rotate_widget_key`. Old key revoked; existing inflight requests with it 401. |
| Rotate the identity secret | `conv_rotate_widget_identity_secret`. Previously-issued `data-user-hash` values stop verifying; re-render signed-in pages with freshly-computed hashes. |
| Tighten `originAllowlist` | `conv_update_widget_channel`. |
| Inspect a conversation | Standard `conv_*` tools. The `metadata.sessionId`, `metadata.providerMessageId`, and `metadata.url` fields tell you the visitor's session. |
