---
'@getmunin/backend-core': patch
'@getmunin/db': patch
---

Scope operational alerts to a single org member.

Every alert source so far has been an org-level fault — a provider outage, a
channel that stopped polling — where any owner can act. Integrations that
authorise per person are not like that: when one member's credential expires,
only that member can re-authorise it, and an alert addressed to the whole org
is noise nobody else can clear.

`org_alerts` gains a nullable `user_id`. NULL means org-scoped, which is what
every existing row is and what every current writer still produces, so the
column is additive and needs no backfill.

Two database objects enforce this table's shape and neither is visible to
`schema.ts`, so `drizzle-kit generate` could not have found them. The `source`
CHECK constraint from 0034 has to learn `social` — adding the value to the
`ALERT_SOURCES` union alone would have passed typecheck and failed at runtime.
More importantly, the partial unique index `org_alerts_open_uniq` is what
actually enforces one open alert per key, since `openAlert` does a
find-then-insert that is racy without it; its key had to gain `user_id` or two
members whose credentials expire under the same source and subject would
collide on insert and one member's alert would be lost.

Visibility is filtered in `AlertsService` against `actor.userId`, not in RLS.
The tenancy GUCs carry an org and an end-user id, and an end user is a
customer rather than an org member, so there is no member identity for a policy
to key on. Tenant isolation remains RLS's boundary; `get` and
`acknowledgeAlert` now also scope explicitly by org rather than leaning on the
policy alone.

An owner does not see another member's user-scoped alerts. They cannot act on
one, so surfacing it only adds a row they have no way to clear. That holds
while per-member integrations are peripheral; if a critical one lands, the
exception is one predicate here rather than a redesign.
