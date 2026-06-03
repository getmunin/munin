---
'@getmunin/core': patch
---

`safeFetch`: factor the agent's connect-time DNS lookup behind a `ConnectLookup` seam and expose it as the optional `__connectLookup` option on `SafeFetchOptions`. Behavior is unchanged when the option is not passed — the default uses `dns.lookup` with `{ all: true, verbatim: true }`. The SSRF DNS-rebinding regression test stops depending on real-world DNS for `127.0.0.1.nip.io` (a flaky source of test timeouts on CI) and uses the seam to deterministically simulate a connect-time DNS that returns a private address.
