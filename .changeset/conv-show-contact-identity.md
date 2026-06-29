---
"@getmunin/backend-core": minor
"@getmunin/dashboard-pages": minor
---

Show who a conversation is with in the inbox drawer instead of a bare end-user id.

`GET /v1/conversations/:id` (and the `ConversationDetail` it returns) now carries
the resolved counterpart identity — `contactEmail`, `contactName`, `contactPhone`
— preferring the linked `conv_contacts` row and falling back to the `end_users`
row. Both the full and simplified conversation drawers render the email (then
name) in the header rather than the raw end-user id.

Also tightens the queue row layout so long titles truncate and the row actions
swap in on hover without overlapping the timestamp.
