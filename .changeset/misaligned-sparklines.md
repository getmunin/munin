---
'@getmunin/dashboard-pages': patch
---

Fix misaligned usage-KPI sparklines on the dashboard. Three causes were making the four cards' sparklines sit at inconsistent vertical positions:

- **Stroke clipping** — the polyline mapped values to the full `0–22` viewBox height, so the 1.2px stroke was sliced in half at peaks and troughs. Values now inset into a `2–20` band so the line never touches the edges.
- **Floating flat lines** — a constant series (`max === min`) no longer floats at an arbitrary height; it rests on the baseline like every other card's minimum.
- **Collapsing delta row** — a tile with no comparison (e.g. API calls, whose previous period is 0) rendered an empty space that HTML collapsed to zero height, shifting its sparkline up by one line. The placeholder is now a non-breaking space so the row keeps its height.
