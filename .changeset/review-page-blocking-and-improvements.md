---
'@getmunin/dashboard-pages': minor
'@getmunin/ui': minor
'@getmunin/backend-core': minor
---

Learning becomes Review, and everything waiting on an admin moves into it.

`/dashboard/learning` is now `/dashboard/review`, and the page is no longer only about
knowledge proposals. The four things that queue up for a human decision — CMS drafts, CRM
merge proposals, outreach drafts, and forwarded feedback — leave the admin overview and
join the KB candidates here, split into two sections that carry different urgency:

- **Blocking** — everything that stops something from shipping, sorted **oldest first** so
  the longest wait is at the top. A blocking queue sorted by recency buries exactly the
  item that has been ignored the longest, which is the opposite of what the section is for.
- **Improvements** — knowledge proposals, newest first, separated by a rule rather than a tint.
  These have no deadline: the base is already answering customers, and a proposal only makes it
  answer better. Keeping them in the same list as an unsent email made them look overdue, but
  tinting or dimming the rows overcorrected — the section label carries it.

`Pill` gains a `marker` variant so the detail pane's module pill can carry the same glyph its list
row does — a square for CMS, a diamond for CRM, a hollow ring for KB — instead of the generic filled
dot every tone rendered before.

**Outreach gets a purpose-built pane** rather than the sheet drawer reused in place. It is ordered by
what you must not get wrong: the message as it will arrive, then why it is being sent, then when.

- The **envelope is rendered** — from, to, subject — and so is everything the send path appends,
  as the literal text it will append rather than two booleans in a note at the bottom: the
  campaign's CTA URL on its own line, then the fixed `---` / Unsubscribe footer, under one
  "appended on send" marker. `ProposalCampaignSummary` gains `ctaUrl` (already selected by the
  query, only ever used to compute `appendsCta` and then dropped), `ProposalDelivery` gains
  `sender` / `senderName` off the channel's own addressing config (allow-listed through
  `publicChannelConfig`, so no credential can leak into a DTO), and `ProposalContactSummary` gains
  `companyName`, so the pane can say who it is going to.
- **"Why this, why now" now exists.** `evidence` was already one call away on
  `/v1/outreach/proposals/:id` and the dashboard never fetched it. It is freeform jsonb whose shape
  varies per drafting agent, so it is rendered by *shape* rather than by an allow-list of keys:
  long values and known reason keys become prose, `kb://` and `kdoc_` references become linked
  chips, and everything else becomes a labelled chip. A parser keyed to the documented example
  would have rendered nothing for the proposals already in the dev database, which is what the
  tests pin.
- **Send timing is a control on the page**, not a dialog behind a button — the agent's proposed
  time, send now, or a picked time. The cadence annotations the design asks for next to it need
  campaign `cadenceRules`, which are not on the DTO yet, so they are left out rather than faked.
- **SMS and voice are first-class.** No subject row, no CTA or unsubscribe placeholders, a live
  segment count as you edit, and the sender rendered as a number. A contact with no address on
  file blocks approval outright and says why, instead of tinting a note the same weight as
  everything else and failing at the service.
- `BodyDiff` gains `wrap`: these are prose bodies in a ~700px pane, where horizontal scrolling
  through an email diff is unusable.

The reply-thread quote is deliberately *not* carried over from the old drawer: it quoted the
proposal's own snippet, not the inbound message it was replying to. Showing the real thread needs
the conversation fetch, so the block is gone until then rather than wrong.

Selecting a blocking item renders the existing per-module drawer in the split's right pane
rather than a sheet, so the CMS field editor, outreach scheduling, and the merge preview all
work unchanged and are now deep-linkable at `/dashboard/review/:id`. `DrawerHeader`'s close
button became optional for that: in a persistent pane it pointed nowhere, because the list
immediately re-selects the first row.

The overview drops the queue concept entirely — no "Waiting on you" list, no count in the
hero, no stat row. The sidebar badge on Review is the single signal that work is pending,
and it now counts all five kinds instead of only KB candidates.
