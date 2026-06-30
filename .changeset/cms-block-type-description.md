---
"@getmunin/backend-core": minor
---

CMS: block types can carry an optional `description`. Each entry in a `blocks` field's `options.blockTypes` now accepts a `description` (≤500 chars) alongside `name` and `label`, so a collection can tell the agent what a block is for and when to use it while authoring (e.g. "Highlights a warning the reader must not miss; not for ordinary body text"). Optional and additive — existing collections and block content are unaffected.
