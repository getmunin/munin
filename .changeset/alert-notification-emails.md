---
'@getmunin/backend-core': patch
'@getmunin/emails': patch
'@getmunin/db': patch
---

Email the people who can act on an alert when one opens.

An alert that only appears in the dashboard is only seen by someone already
looking. Owners get mail for org-scoped faults; a member gets mail for a fault
on their own account, because nobody else can clear that one for them. The
two routes follow the same rule that governs visibility, so there is one
notion of who an alert belongs to rather than two.

`openAlert` runs inside the caller's request transaction, so sending from
there would be external I/O inside a transaction — exactly what the event-sink
rule forbids. An `EventSink` on `org_alert.opened` enqueues into a new
`alert_notifications` table and a drain worker sends, the same shape as
`slack_deliveries` and `webhook_deliveries`.

The enqueue is idempotent by construction rather than by care.
`org_alert.opened` is emitted only when a row is first inserted and never on an
occurrence bump, so a fault that repeats two hundred times enqueues once; the
unique key on `(alert_id, recipient_user_id)` is the backstop rather than the
mechanism. The worker also re-reads the alert at send time and closes the
notification silently if it has already resolved, so a fault that fixes itself
inside one poll interval sends nothing.

Because rows are only ever enqueued by the sink, a deploy does not mail anyone
about alerts that were already open when it shipped — the queue starts empty
and fills from the next alert onward.

Not every alert is worth an inbox. `NOTIFY_POLICY` is keyed per source: the
existing channel and provider sources notify on `error` only, `curator` never
notifies, and `social` notifies from `warning` because an expiring credential
needs a person before it becomes an outage. `MUNIN_ALERT_EMAILS_DISABLED`
switches the whole path off; a per-member preference can follow if anyone
wants one.

The alert's own `title` and `detail` are composed in English by whichever
service raised it, so only the email's chrome is localised. Translating the
body properly means replacing `title` with a key plus parameters across every
existing call site, which is unrelated work.

Two things in `@getmunin/emails` are worth knowing. `pickLocale` returns
`typeof en`, so `nb` is structurally checked against `en` and a missing or
mistyped string fails the build — but TypeScript accepts a function that takes
*fewer* parameters than the one it is assigned to, so an `nb` string that
silently drops an interpolation argument typechecks and then renders without
the value. `locale parity` covers exactly that gap and nothing TypeScript
already handles.
