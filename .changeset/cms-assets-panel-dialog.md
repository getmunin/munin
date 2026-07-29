---
'@getmunin/inspector-app': patch
'@getmunin/dashboard-pages': patch
---

CMS: the `cms_list_assets` panel shows two rows and opens an asset in a dialog.

The panel rendered every asset the tool returned — an org with 60 images got 60 thumbnails, and picking one appended a detail block below the fold, so the thing you clicked and the thing you wanted to read were never on screen together.

- **Eight thumbnails, then a footer control.** The grid is pinned to four columns (two on narrow hosts) and cut at two rows. The footer carries the state and the action: `8 OF 16 ASSETS` alongside `SHOW ALL 16 ↓`, toggling back to `SHOW FEWER ↑`. Nothing is dropped silently — the count is always the full total, and the toggle only appears when there is something hidden.
- **Clicking a thumbnail opens a modal over the grid**, not a block under it: scrim, viewport-centered card, image scaled to fit, then the name, mime and size, alt text, the public URL with a copy-to-clipboard button, and the usage line from `cms_list_asset_usage` (still fetched once per asset and cached). Escape, the ✕ and a scrim click all close it. Copy degrades quietly where the host iframe withholds clipboard access.
- **The backdrop matches the shared dialog** (`packages/ui` `DialogBackdrop`): `ink/40`, no blur, no drop shadow. The design mock called for a blurred scrim and a 60px shadow, but nothing else in the system does that — none of the 21 UI components carry a shadow at all.
