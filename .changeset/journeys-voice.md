---
'@getmunin/backend-core': minor
'@getmunin/types': minor
'@getmunin/dashboard-pages': minor
---

Journey call steps: a `message` node with `channel: "voice"` files a call proposal on `settings.voiceChannelId`, which only a signed-in person can approve. Once the call is placed the step waits for the outcome pass to record `reached`, `no_contact`, `refused` or `wrong_contact` and follows `onOutcome`, continuing on `next` after `outcomeTimeout` (default 6 hours) or for an unmapped outcome. Outcome extraction now always runs for journey calls, even when the wrapped campaign declares no extraction fields, and the dry run assumes the call is answered.
