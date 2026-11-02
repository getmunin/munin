---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
---

Fix Threll voice turns still mirroring to Slack out of order after a caller's final transcript resolves later than a turn that answered it.

The earlier fix (slack_deliveries ordered by a synthesized turn position) only reorders rows still sitting in the queue — once a later turn is posted to Slack's append-only thread, an earlier turn that resolves afterward can never be moved ahead of it. Threll actually tells us a turn's true position the moment it starts: an empty-text `isFinal: false` interim registers the turn immediately, before speech recognition resolves its text. Munin now acts on that interim — inserting a pending placeholder (shown as `…`) in true turn order — and fills it in via an update (`conversation.message.body_revised`, the same path already used for redaction edits) once the final arrives, instead of inserting a new row whenever the text resolves. The Slack post now always lands in the right slot; only its content fills in late.
