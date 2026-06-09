---
'@getmunin/backend-core': minor
---

Refuse to mint or update widget channels and analytics trackers with an empty origin allowlist when the corresponding `MUNIN_*_REQUIRE_ALLOWLIST` env is on.

Previously the env flag was only consulted at request time deep in `enforceOriginAllowlist`, so an admin (or agent) could mint a key with an empty allowlist, see the dashboard render it as "any origin", and only discover at the first browser request that every origin gets a 403. The dashboard's "any origin" pill was particularly misleading on backends with the flag on — it meant "blocks everything" but read as "permissive".

`conv_widget_create_channel`, `conv_widget_update_channel`, `analytics_create_tracker`, and `analytics_update_tracker` now reject empty `originAllowlist` / `allowedOrigins` with `BadRequestException('origin_allowlist_required: …')` when the env flag is on. Update tools only check when the caller is actively changing the list (passing `undefined` to leave it as-is still works, so existing channels aren't retroactively broken — they're just blocked at the request edge as before until someone explicitly fixes them).
