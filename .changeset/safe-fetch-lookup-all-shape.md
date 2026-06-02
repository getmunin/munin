---
'@getmunin/core': patch
---

**Critical fix:** `safeFetch` now returns the array-shaped callback undici expects when it asks for `all: true` resolution.

Every `safeFetch` call against a non-IP-literal host (i.e. virtually every real-world call) was failing with `TypeError: fetch failed` → `cause: Invalid IP address: undefined` after undici started passing `lookup({ ..., all: true }, cb)`. The custom SSRF agent's `lookup` was forcing `all: false` internally and calling `cb(null, address, family)`. Undici read the wrong shape from that callback, ended up with `undefined` where it expected an IP, and threw inside `node:net`'s `emitLookup`.

The fix: always resolve with `all: true` (which also lets us SSRF-check every resolved address, not just the first one), then format the callback response to match what undici asked for — array if `all: true`, single string if `all: false`. Adds a regression test that fetches through the DNS path against an `*.nip.io` hostname with `MUNIN_SSRF_ALLOW_PRIVATE` set (existing tests used literal `127.0.0.1`, which short-circuits the lookup callback and didn't exercise this code).

Impact of the bug while live: AI provider credential validation, model listing, agent-runtime LLM calls, outbound webhook delivery (incl. CMS-content webhooks), and website-import crawls all failed against any real host.
