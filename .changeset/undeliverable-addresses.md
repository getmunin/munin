---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
'@getmunin/db': minor
---

Track address deliverability separately from consent, and check it before an outreach send

Munin had no notion of an email address being undeliverable. It knew only about consent — `crm_contacts.do_not_contact` and `unsubscribed_at` — so when an address died, outreach kept mailing it forever.

Overloading the consent fields would have been the wrong fix: someone who changed jobs has not opted out, and `do_not_contact` suppresses the *person*, on every channel, permanently. Consent is permission; deliverability is reachability. They now move independently.

**New state.** `crm_address_deliverability` is keyed by `(org_id, address)` — not by contact, because a contact has more than one address over time and the whole value is being able to say "that one is dead, this one isn't". It holds `valid | soft_failing | undeliverable`, the rule that fired, the evidence, a failure count and the timestamps. `crm_get_contact` surfaces it as `deliverability` (null while the address is fine).

**Signals**, strongest first:

- A delivery-status report (RFC 3464) or `X-Failed-Recipients` naming the recipient → `undeliverable`, `hard_bounce`. Only a named recipient counts; a bounce that names nobody records nothing.
- An outbound delivery reaching `dead` → `undeliverable`/`smtp_rejected` when the SMTP error is a permanent recipient rejection (`5.1.x`, "user unknown"), `soft_failing`/`delivery_dead` when it is about the mailbox itself (full, over quota), and **nothing** otherwise. Bad credentials, an unreachable host or a content-policy rejection say nothing about the recipient — a broken channel must not condemn every address it touches.
- A no-reply "mailbox no longer available" notice on an existing thread → `soft_failing`/`no_reply_notice`. It is prose from a company's autoresponder rather than an MTA, so it is corroboration, not a verdict.

Soft failures reach `undeliverable` only at three inside a rolling 30 days, and the window resets — a full mailbox or a weekend outage does not accumulate into a permanent verdict by accident.

**The gates.** All five outreach send gates now check it — `proposeInitial`, `proposeFollowup`, `deliverInitial`, `deliverFollowup`, and the follow-up sweep's SQL — and only for email channels, since the state is about an email address. They fail with `outreach_undeliverable`, distinct from the consent refusal's `outreach_invalid`, so a caller can tell "we may not mail this person" from "we cannot reach them here". The dashboard's outreach review pane shows the warning before the operator clicks Approve, and the error is translated (en/nb).

**The way back.** `crm_set_address_deliverability` lets a human or an agent condemn an address or reopen it (`state: "valid"` zeroes the failure count), and `crm_list_address_deliverability` shows the backlog. `skill://crm/repair-undeliverable-address` walks an agent through finding a person's current address — and through why the answer is never `do_not_contact`.

Surfaced by uScore conv #186, where a recipient had left their employer and `kaefer.no` answered every send with "the email address you have tried to reach does not exist within our company anymore".
