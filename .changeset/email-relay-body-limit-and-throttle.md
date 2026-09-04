---
'@getmunin/backend-core': patch
---

Make `POST /v1/conversations/email/relay` actually accept the 30 MiB it advertises, and stop throttling it per client IP.

The controller checked the decoded message against a 30 MiB cap, but the global JSON body parser in `createApp` is capped at 4mb, and a base64 relay envelope is ~1.37× the message — so any email over roughly 3 MB was answered by Express with `413 request entity too large` before the controller ran. The relay path now gets its own route-scoped `express.json` parser mounted ahead of the global one, sized from the same constant (`EMAIL_RELAY_BODY_LIMIT_BYTES` = base64 expansion of `EMAIL_RELAY_MAX_RAW_BYTES` plus 1 MiB of envelope, ≈41 MiB) and setting `req.rawBody` the way Nest's `rawBody: true` does, so HMAC verification is unchanged. The global 4mb limit still applies everywhere else. A request on that path without an `x-munin-relay-signature` header is refused 401 before the body is read, so unsigned traffic cannot make the server buffer 40 MB per request.

The controller was also declared with `throttle: true`, which applies the public per-IP throttle (60/min, 1000/hour). All customers' relayed mail arrives from the operator's one or two MX addresses, so that was a platform-wide ceiling of 1000 inbound emails per hour. The endpoint authenticates every request by HMAC, so the IP throttle is dropped.
