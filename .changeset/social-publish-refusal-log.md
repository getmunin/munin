---
'@getmunin/backend-core': patch
---

Log the platform's reason when a social publish is refused.

`publishDraft` stored the refusal in `social_post_drafts.last_error` and threw
`BadGatewayException`. That is an `HttpException` and `backend-core` registers no
exception filter, so Nest logged nothing at all — an operator watching the logs
saw a successful-looking request stream while every publish failed, and the only
way to the reason was a query against the drafts table.

`SocialService` now warns with the platform, the draft id and the reason before
the row is marked failed. A revoked grant already opens a system alert with a
reconnect CTA; a platform refusal opens nothing, which is why it needed a log
line of its own.
