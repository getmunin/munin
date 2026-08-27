---
'@getmunin/dashboard-pages': patch
---

Card grids on Trackers, Channels and Integrations now share one layout. The settings content column has no max-width, so the Trackers page's two-column grid stretched each card to roughly 600px on a wide viewport — twice the width of a channel or connector card, with a 160px sparkline floating in it. `CardGrid` and `CardGridSkeleton` lost the `columns` prop entirely: every call site rendered three columns except that one, so hardcoding the layout is what keeps the pages from drifting apart again.

The two Integrations sections also loaded behind a single full-width `CardSkeleton` while Trackers and Channels loaded behind a `CardGridSkeleton`, so the placeholder was a wide bar where the real content is a grid of cards. Both sections now use `CardGridSkeleton` at the card count they actually render — three for connectors, one for the Slack bridge.
