---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
'@getmunin/types': patch
'@getmunin/core': patch
---

Classify and name API-key callers in the activity feed from the key itself. `actorKind` was guessed from the actor id's prefix, which mapped every `akey_*` caller to `widget` — so admin service keys were reported as widgets on `GET /v1/activity`, and they carried no `actorLabel` at all, leaving the feed to show a truncated raw id. Actor resolution now reads `api_keys`, labels the row with the key's name, and derives the kind from its type (`widget` / `track` → `widget`, everything else → `agent`).

Drop the dead prefix branches from the same classifier. `usr_` never matched a BetterAuth-created user (those ids resolve through the `users` lookup first anyway) and `agt_` existed only in test fixtures.

Give the synthetic actors a kind instead of reporting them as `unknown`: the in-process agent runtime (`agent-host:<org>`, `agent-host:<org>:<end user>`) is an `agent`, and the scheduler and read-tracker actors are `system`. The classifier now lives in `@getmunin/types` as `actorKindFromId`, alongside named constants for each synthetic actor id, so the server and the dashboard's realtime fallback cannot drift apart and the code that mints these ids shares the string with the code that reads it. `GET /v1/activity` had no test of its own; it now covers both key kinds, a BetterAuth user id, the runtime actors, the system actors, and an unplaceable id.
