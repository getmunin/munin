---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
---

Report the real "needs your attention" count on the overview and sidebar badge instead of saturating at 50.

`GET /v1/inbox` returns `live` as a preview list capped at 50 conversations, and the dashboard counted that array: the overview stat row and the console sidebar badge both froze at 50 once an org had more flagged conversations than that. An org with 65 waiting saw 50, with no hint anything was missing.

The response now carries `liveTotal` — a `COUNT(*)` over the same filters the list uses (flagged and not closed/spam, plus actively claimed conversations whose flag was already cleared) — and both counters read that instead of `live.length`. The list itself stays capped; only the number is exact.

Two smaller consequences: `ConvService.countConversations` is new and shares `buildConversationListFilters` with the list queries, so filters can never drift between count and page; and `listConversationsByIds` takes an optional `needsHumanAttention` filter, which lets the claimed-only branch ask for exactly the unflagged claims rather than subtracting a truncated id set — previously a flagged-and-claimed conversation ranked past the 50th leaked into the list through that subtraction.
