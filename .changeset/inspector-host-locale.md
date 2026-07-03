---
'@getmunin/inspector-app': minor
'@getmunin/dashboard-pages': minor
---

Localize the inspector panel from the MCP App host locale.

- The panel reads `getHostContext()?.locale` after connect (falling back to `navigator.language`, then `en`) and re-renders on `onhostcontextchanged`, so it follows the user's Claude language setting rather than the iframe's browser default.
- Strings live in a new `inspector.*` namespace in `@getmunin/dashboard-pages`' message catalogs (English + Norwegian), now exposed via a `./messages/*.json` export; the panel bundles only that namespace (~1 kB per locale) through a small `t(key, params)` helper.
- Ages in the proposal ledger format through `Intl.RelativeTimeFormat` with the host locale instead of hardcoded English abbreviations.

Server-originated strings (tool error messages) remain English.
