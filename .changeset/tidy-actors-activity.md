---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
---

Classify and name API-key callers in the activity feed from the key itself. `actorKind` was guessed from the actor id's prefix, which mapped every `akey_*` caller to `widget` — so admin service keys were reported as widgets on `GET /v1/activity`, and they carried no `actorLabel` at all, leaving the feed to show a truncated raw id. Actor resolution now reads `api_keys`, labels the row with the key's name, and derives the kind from its type (`widget` / `track` → `widget`, everything else → `agent`).

Drop the dead prefix branches from the same classifier in both the controller and the dashboard page. `usr_` never matched a BetterAuth-created user (those ids resolve through the `users` lookup first anyway) and `agt_` existed only in test fixtures, so the remaining fallback is the literal `system` actor and otherwise `unknown`. `GET /v1/activity` had no test of its own; it now has one covering both key kinds, a BetterAuth user id, and an unresolvable actor.
