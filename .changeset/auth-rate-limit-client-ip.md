---
'@getmunin/backend-core': minor
---

Auth rate limiting can bucket per client IP behind a multi-hop reverse proxy.

better-auth reads the client IP from `X-Forwarded-For`, and without a trusted-proxy list it only trusts a header that carries exactly **one** entry — a chain is unresolvable, because the leftmost entry is caller-controlled and nothing identifies where the caller's part of it ends. Any deployment whose platform appends its own hops therefore resolved no IP at all and fell back to `no-trusted-ip`, a single shared bucket per path: one abusive client consumed the sign-in budget for every user at once. It logged one line and otherwise looked healthy — `WARN [Better Auth]: Rate limiting could not determine a client IP`.

`advanced.ipAddress` is now configurable, from two env vars or from the new `ipAddress` option on `createMuninAuthCore` (the option wins):

- `MUNIN_AUTH_TRUSTED_PROXIES` — IPs or CIDR ranges of your own proxies. The chain is walked right to left, trusted hops are skipped, and the first untrusted address is the client.
- `MUNIN_AUTH_IP_HEADERS` — headers to read instead of `x-forwarded-for`, in order, lowercased for you. For a single-value header a proxy overwrites, such as `cf-connecting-ip` behind Cloudflare.

Neither is set by default, so nothing changes for an existing deployment until it opts in, and a single-proxy setup that already emits a one-entry `X-Forwarded-For` needs neither.

Two properties worth knowing before choosing a value. Trusting the range your platform's hops live in stays spoof-proof, because a platform inserts the real client address *after* everything the caller sent and before its own hops — so entries a caller prepends, even ones inside the trusted range, sit to the left of the client and are never reached. And only name a header in `MUNIN_AUTH_IP_HEADERS` that your proxy *overwrites*: `x-real-ip`, `x-client-ip` and `Forwarded` are commonly passed through untouched, and trusting one of those removes the rate limit rather than fixing it.
