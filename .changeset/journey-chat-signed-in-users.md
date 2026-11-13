---
"@getmunin/backend-core": minor
---

Journey chat now reaches signed-in people without manual CRM setup, and a page they open can start a journey.

A signed-in identity is linked to the CRM contact that holds its signed email: on the widget's verified sign-in, on the tracker's `identify`, and when a product event sends `externalId` with `email`. A contact already linked to another identity is left alone. When a signed-in person with no contact enters a person journey, the journey creates one from the sign-in (name and signed email, no lawful basis), so a chat step can write to them. Anonymous visitors still get no contact. When the runtime enters someone from an event or a segment, the contact it creates starts no other journey, because events the runtime raises never start journeys. Before this change, journey chat was skipped with `no_chat_identity` for anyone whose contact had not been linked by hand or through a conversation.

Page views from identified visitors now reach journeys as `analytics.page.viewed`, with `subjectType`, `subjectId`, `path`, `locale`, `referrer` and the UTM fields under `properties`. They work as an entry trigger, in `wait_for`, as a goal and as an exit; a branch's `{ event }` condition does not see them. To keep page traffic out of the journey inbox, a view is forwarded only when it is newly recorded, comes from a non-anonymous identity, and the org has a live or paused journey whose spec names `analytics.page.viewed` (checked at most once a minute per org). `skill://journeys/build-journey` and `skill://analytics/identify-visitors` describe both changes.
