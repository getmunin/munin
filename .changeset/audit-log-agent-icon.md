---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
'@getmunin/core': patch
'@getmunin/db': patch
---

Audit log: show the agent icon in front of the client, and stop calling every browser
"dashboard".

`GET /v1/audit-logs` now returns `clientIconUrl` alongside `clientName`, read from the
OAuth client's registered logo, and the client column renders the same glyph the Agents
page uses (icon when the client registered one, first-letter fallback otherwise). The
glyph moved into a shared `ClientGlyph` component so both pages stay in sync.

`classifyClient` used to label any `Mozilla/*` user agent `dashboard`, which swept up
every other browser caller — a customer's own web UI, a docs "try it" console, Swagger.
`dashboard` now requires a session-authenticated actor with no OAuth client (only our
own dashboard holds a BetterAuth session cookie); every other browser caller classifies
as the new `browser` kind, filterable from the client dropdown. Audit rows also record
the calling `origin` (`Origin` header, falling back to the `Referer`'s origin), so a
`browser` row shows the origin host — `docs.getmunin.com` — instead of a generic label,
with the full origin and user agent in the cell tooltip. Existing rows keep a null
origin and read as the bare kind.
