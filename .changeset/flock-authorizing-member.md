---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
---

feat(access): show the authorizing member on each flock row

The flock (Settings → Agents) groups OAuth connections by client *and* the org member who authorized them, but only the client name was shown — so two members who each connected, say, Claude produced two visually identical rows with no way to tell whose access a revoke would cut off.

`GET /v1/tokens` now joins the authorizing user and returns `user: { name, email }` per row. The Agents page shows that member inline after the client name ("Claude · Kjell Rune Monsø", with the email on hover and as the fallback when no name is set), replacing the "· N connections" count — which only reflected dynamic-client-registration reconnects and wasn't actionable, since a row already represents one member's access to one client and revoke cuts off that whole group.
