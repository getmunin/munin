---
title: 'Conv: Track email opens'
description: Turn on open tracking for an email channel, then read per-message and per-channel open numbers — and report them with the caveats that pixel tracking carries.
audiences: [admin]
---

# Track email opens

Munin can record when a recipient opens an email it sent. Use this when an operator
asks "did they read it?" about one message, or wants open rates across a channel.

## How it works

Outbound email carries a 1×1 transparent GIF whose URL encodes a signed token for
that delivery. When the recipient's client loads the image, Munin stamps the
delivery row: first open, last open, and a running count. The first open also emits
the `conversation.message.opened` webhook.

A pixel is only embedded when **all** of these hold:

- the channel has `outbound.trackOpens: true`,
- the message has an HTML part (text-only mail carries no image), and
- the server has `MUNIN_KEY_PEPPER` set (it signs the token).

Requests that look like bots are ignored, so link-scanners and security appliances
mostly don't register as opens.

## Turn it on

`trackOpens` lives on the outbound half of an email channel's config, for both the
`smtp` and `mailer` providers:

```jsonc
{
  "name": "conv_configure_email_channel",
  "arguments": {
    "channelId": "chn_…",
    "outbound": { "provider": "mailer", "trackOpens": true }
  }
}
```

It is off unless someone turned it on. A channel that has been sending for months
with tracking off has no history to backfill — numbers start at the moment it is
enabled.

## Read the numbers

**One conversation.** `conv_get_conversation` returns `firstOpenedAt`,
`lastOpenedAt` and `openCount` on each message.

The three fields distinguish two different "no data" cases, and the distinction
matters when reporting:

| Fields | Meaning |
|---|---|
| `openCount: null` | No delivery row — the message never went out over email (an inbound message, an internal note, or a widget/SMS message). Opens don't apply. |
| `openCount: 0`, `firstOpenedAt: null` | Sent over email, no open recorded. Either genuinely unopened, or opened in a client that blocks images. |
| `openCount: 3` | Recorded three image loads, the first at `firstOpenedAt`. |

Note that `seenAt` on the same message is a **different** signal: it is the chat
widget's read receipt, set when the recipient scrolls the message into view in the
widget panel, and reported separately as `conversation.message.read`. Email opens and
widget reads never both apply to one message.

**Across a channel.** `conv_get_email_open_stats` aggregates deliveries in a window:

```jsonc
{ "name": "conv_get_email_open_stats", "arguments": { "sinceDays": 30 } }
```

```jsonc
{
  "since": "2026-07-16T09:00:00.000Z",
  "sinceDays": 30,
  "channels": [
    {
      "channelId": "chn_…",
      "channelName": "Support",
      "trackOpens": true,
      "sent": 412,
      "opened": 233,
      "totalOpens": 501,
      "openRate": 0.566
    }
  ],
  "totals": { "sent": 412, "opened": 233, "totalOpens": 501, "openRate": 0.566 }
}
```

- `sent` counts deliveries that actually left the building in the window (status
  `sent`), not queued or failed ones.
- `opened` counts deliveries opened **at least once**; `totalOpens` counts every
  load, so it runs higher when people reopen a thread.
- `openRate` is `opened / sent`, or `null` when nothing was sent.
- Pass `channelId` to scope to one channel. A non-email channel id is rejected.

## Report it honestly

Open tracking is best-effort, and the failure modes push in both directions. Say so
when you present a number rather than quoting it as fact:

- **Under-counts.** Gmail, Outlook and most corporate clients block remote images by
  default. A blocked image is indistinguishable from an unread message.
- **Over-counts.** Apple Mail Privacy Protection pre-fetches every image the moment
  mail arrives, so those recipients register an open whether or not a human looked.
  Some corporate gateways do the same.
- **`trackOpens: false` reads as a 0% rate**, because no pixel was ever embedded.
  Always check the flag in the response before calling a channel's rate low — the
  stats tool returns it for exactly this reason.

Treat the number as a floor with noise on top: useful for comparing two sends on the
same channel, not for telling an operator that a specific person did or didn't read
a specific message.

## React to opens

Subscribe to `conversation.message.opened` (see `skill://webhooks/subscribe-to-events`)
to act on the first open of a message. Payload:

```jsonc
{
  "type": "conversation.message.opened",
  "payload": {
    "deliveryId": "cmd_…",
    "messageId": "msg_…",
    "firstOpenedAt": "2026-08-15T09:14:02.000Z"
  }
}
```

It fires **once per delivery**, on the first open only — repeat opens bump
`openCount` silently. Don't build a "still unread after N days" alert on the absence
of this event alone; blocked images make that alert fire on people who read the mail.
