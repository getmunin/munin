---
'@getmunin/core': patch
'@getmunin/backend-core': patch
---

Social post media and link-preview fetches now go through the shared `safeFetch` guard instead of a module-local check. The shared guard pins DNS at connect time and re-checks every redirect hop, so the social module now refuses IPv4-mapped IPv6 hosts, hostnames that re-resolve to a private address between check and connect, and the reserved ranges the local check missed. A blocked destination is reported as "not an allowed destination" and a network failure as "could not fetch", without echoing what an internal host answered.

`safeFetch` itself:

- `SsrfBlockedError` messages no longer include the private address a hostname resolved to, and a failed lookup reads the same as a private one; the resolved address stays in the server log and on the error's `detail` field.
- NAT64 `64:ff9b::/96` addresses are judged by the IPv4 address they embed, `64:ff9b:1::/48` and IPv4-compatible `::a.b.c.d` addresses are refused.
- A bracketed IPv6 URL host is checked as the literal it is rather than handed to the resolver.
- The response's `url` is the URL it finally landed on after redirects, so relative links and `og:image` values resolve against the right page.
