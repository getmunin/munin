---
"@getmunin/dashboard-pages": patch
---

Tidy up the origin-allowlist create forms. The "Leave empty to allow any origin" hint is gone from both the widget channel and analytics tracker forms — it's misleading when the deployment requires an allowlist. When an allowlist is required — `NEXT_PUBLIC_WIDGET_REQUIRE_ALLOWLIST=1` for the widget form (mirroring backend `MUNIN_WIDGET_REQUIRE_ALLOWLIST`), `NEXT_PUBLIC_TRACKER_REQUIRE_ALLOWLIST=1` for the tracker form (mirroring `MUNIN_TRACKER_REQUIRE_ALLOWLIST`) — the origin field is marked `required`, so an empty submit is blocked client-side with the browser's native "Please fill in this field" prompt instead of a round trip to the server. The bespoke "at least one origin required" message has been removed in favour of the native one.

Also fix the full-page loading spinner background. In light mode it rendered `bg-bone` (`#E8E4DC`, the warm outer chrome) while the body and page content are `bg-background` (`#FBFAF7`), so the spinner was a visibly different shade than the page it was loading. All full-page spinners now use `bg-background`, matching the body exactly in both light and dark mode.

And fix the agent-recipe links on the dashboard Get Started screen, which pointed at `/guides/recipe-*` (a 404) when `NEXT_PUBLIC_DOCS_URL` was unset. They now use the same resolved docs host as the MCP setup snippets (`DEFAULT_DOCS_HOST`, which includes the `/docs` base), so they correctly land on `/docs/guides/recipe-*`.
