---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
---

Count the whole Conversations queue server-side, and let the list reach past the first 100 rows.

The Conversations page loaded one 100-row page of open conversations and partitioned it client-side, so `Needs your attention · {count}` counted only what the client happened to fetch. The queue is ordered by `lastMessageAt DESC`, so the rows that fell off the bottom were the least recently active ones — exactly the flagged, un-replied conversations the header is meant to point at. They were neither counted nor reachable from the page.

`GET /v1/conversations/queue/counts` is new: `ConvService.countConversationQueueSections` runs one aggregate over the open conversations, splitting them into `needsYou` / `inProgress` with the same rule the client used (claimed by the caller, or flagged and unclaimed) by resolving each conversation's newest live claim in SQL. It reuses `buildConversationListFilters`, so the counts cannot drift from the list. The page headers read those totals, and the member sidebar badge reads `total` instead of the length of a `limit=100` fetch that saturated at 100.

The list itself now follows `nextCursor` behind a "Load more" button rather than fetching every page on load, and a refresh re-fetches as many pages as are on screen so a realtime event does not collapse the list back to the first page. The Done section keeps its client-side 7-day window.
