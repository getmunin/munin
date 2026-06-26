---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
---

feat(access): OAuth-only flock with client identity; tidy end-user display

**The flock (Settings → Agents)** now lists only OAuth-authorized agents. Delegated end-user tokens are no longer mixed in — they're managed on the End-users page. Each row leads with the OAuth client's name (e.g. "Claude · 3 connections") and a small client icon/glyph (matching the consent screen) instead of a generic "OAuth refresh token" label, the Origin column is dropped (its info moved into the primary label), and the table uses a fixed layout so the scopes list wraps inside the Token column instead of squeezing the other columns. `GET /v1/tokens` returns only OAuth agents (with `iconUrl`) and no longer merges the `tokens` table.

**The End-users page** now shows a single identity line (name, else email, else phone, else "—") with an avatar of initials derived from the name ("Jens Pettersen" → "JP") or the email's first letter ("kjell@apps.no" → "K").
