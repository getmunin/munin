---
'@getmunin/backend-core': minor
---

Rename `BACKEND_FEATURE_MODULES_NO_AUTH` to `BACKEND_FEATURE_MODULES` and surface the `feedback_*` tools + REST paths in the docs fixtures.

- The old name suggested "modules that don't require auth"; the actual meaning is "feature modules, with no AuthModule included". The shorter name plus the long-standing comment above the list communicates that more clearly. Downstream consumers must update their import.
- `FeedbackModule` is now imported by `backend-core`'s in-package `AppModule`, which is what the docs/openapi generator and integration tests boot. Runtime behavior in `apps/backend` is unchanged: feedback is still gated by `MUNIN_FEEDBACK_ENABLED` per deployment. The MCP docs page and OpenAPI spec now document the five `feedback_*` tools and three REST routes so end users know they exist even when not enabled.
