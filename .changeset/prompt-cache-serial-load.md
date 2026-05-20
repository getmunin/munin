---
'@getmunin/core': patch
---

Load prompt-cache entries serially instead of via `Promise.all`. The previous burst could saturate the in-process MCP transport on cold start (especially when KB seeding is still in flight in the same session) and the parallel reads would all hit the MCP client's 60s timeout in a single instant. Serial load drains one request at a time and adds negligible wall-clock cost (sub-second for a handful of KB doc reads).
