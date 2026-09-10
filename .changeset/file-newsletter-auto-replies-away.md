---
'@getmunin/backend-core': minor
---

File newsletter out-of-office replies away instead of parking them in the inbox forever.

An org that puts its support address in the Reply-To of a marketing send gets one
auto-reply per recipient with a holiday responder on. Suppression already kept those away
from the agent, but suppression stopped the *work*, not the *record*: contact,
conversation and message are all persisted before `if (suppressed) return`, so each one
still opened a conversation.

And that conversation never closed. `listConversationsAwaitingUserReply` — the feed behind
the 2-day auto-close — requires the last non-internal message to be from `agent` or
`user`. An auto-reply-only thread's last message is `end_user`, so it was never eligible;
a 30-day-old one is still open. `metadata->>'suppressed'` appeared exactly once in
`conv.service.ts`, in the awaiting-reply gate, and the auto-close query knew nothing about
it. The queue therefore grew by one row per newsletter send per responder, permanently.

A new conversation whose first message is `suppressed: 'auto_reply'` is now created with
`status: 'closed'`. The record survives and stays searchable, it just never enters the
inbox queue, which needs no auto-close backlog to drain. An auto-reply landing on an
*existing* thread leaves it open — the customer's question there is still owed an answer.
Bounces keep today's behaviour and stay open on purpose: a DSN is how an operator learns a
customer never got their reply, and `conv_retry_delivery` depends on being able to see it.

Detection widened to match, because the well-behaved responders were never the problem:

- **A subject-only autoresponder was not detected at all.** "Automatisk svar: …" or
  "Out of Office: …" with no `Auto-Submitted` header created a conversation the agent then
  drafted a reply to. Anchored prefixes now cover the Nordic, English, German and French
  forms, matched after folding `æ`/`ø`/`ß` and stripping diacritics so `Fraværende:` and
  `Frånvarande:` both land, and after peeling any `Re:`/`Sv:` the responder added. The
  prefix must be followed by a colon or dash, so "Out of office hours support?" and
  "Autosvaret deres virker ikke" stay answerable.
- **`Precedence: bulk` with no list headers** now counts as an auto-reply. A real mailing
  list carries `List-Id`/`List-Unsubscribe`/`List-Post` and is unaffected — that required
  splitting `hasListHeaders` out of `isMailingList`, which is derived partly *from*
  `Precedence: bulk` and so could never have been used as the guard.

Also: `SlackEventSink` mirrored `conversation.message.received` with no suppression check,
so every one of these was reposted into the operator's Slack channel. It now drops any
event flagged `autoReply`, which covers bounces there too — the inbox is where a delivery
failure belongs, not a chat channel.
