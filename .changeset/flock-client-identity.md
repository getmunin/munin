---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
---

feat(agents): show client name + icon in the flock, drop the Origin column

The flock row now leads with the OAuth client's name (e.g. "Claude · 3 connections") and a small client icon/glyph — matching the consent screen — instead of the generic "OAuth refresh token" label. The separate Origin column is dropped (its information moved into the primary label), and the table uses a fixed layout so the scopes list wraps inside the Token column instead of squeezing the other columns. `GET /v1/tokens` now returns the client `iconUrl`. Delegated end-user tokens (no client) keep their type label and a letter glyph.
