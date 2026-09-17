---
'@getmunin/backend-core': minor
'@getmunin/db': patch
---

Add a `social` module: post drafts a person reviews before anything is published.

An article earns nothing sitting on the site, and the step between publishing
one and posting about it is manual, repetitive and usually skipped. This adds
the reviewable unit that step needs. Munin drafts; a person decides; nothing
leaves Munin on its own.

The unit is a post draft, not a companion to an article. That ordering matters:
the generic "store this text for social" tool and the three-or-four-variants
flow are the same table and the same review path, so a draft written in a chat
about nothing in particular behaves exactly like one written from a CMS entry.
Building it the other way round produces a CMS-shaped API that never
generalises. A one-off share is a set of one, which is why `set_id` is
`NOT NULL` and there is no parent table to keep in step.

`social` is deliberately **not** a `ConnectorDomain`. That union drives the
self-service scope maps and the voice self-service gate, and a tool that posts
under an employee's own name has no business being reachable from either. The
platform descriptors live in the module instead.

`SocialPlatformDescriptor` is separate from the publishing adapter that will
come later, so the drafting skill can read real limits before anything can
publish. The skill is instructed to call `social_list_platforms` and write to
the limit it returns rather than to a remembered one — a skill with 3000
characters baked in silently produces unusable drafts the day a shorter
platform is added, and that failure would surface as bad copy rather than an
error. LinkedIn does not charge a post for the characters its links cost, so
`measureBody` subtracts inline link length before comparing against the limit;
`linkCountsTowardBody` exists because that is not true everywhere.

Links are tagged per variant. The stored `linkUrl` stays clean and the tracked
URL is derived, so `utm_campaign` is the set and `utm_content` is the angle —
which means the existing `analytics_list_traffic_sources` already answers which
*angle* earned the clicks, per person, without a new reporting path.

Enum-shaped columns are guarded by CHECK constraints in the migration rather
than in `schema.ts`, matching `org_alerts`. Drizzle cannot see those, so adding
a platform or a status in TypeScript means editing a migration too. That
asymmetry is a real cost and worth knowing about; the benefit is that the
database rejects a bad value instead of storing it.

End-user sessions are excluded from `social_post_drafts` in RLS even when the
org matches. What an organisation is about to say about itself is not something
its customers' delegated tokens should be able to read.
