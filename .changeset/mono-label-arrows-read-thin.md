---
'@getmunin/dashboard-pages': patch
---

The trailing glyph on a mono label link no longer reads as a hairline, and no
longer floats above the words it follows. JetBrains Mono ships none of `→`, `↗`
or `⟳`, so each one was silently falling back to Menlo at a weight and baseline
of its own — which is why they looked thin next to 10px tracked-out uppercase,
and why no single vertical-align could seat all three. A shared `MetaArrow` now
draws them as inline SVG on a 24 viewBox at 12px with a 2.25 stroke, centered
by flexbox, so weight and alignment are ours rather than the fallback font's
(compare-all, see-diff, open-preview, retry, the social permalink, the product
link and the decided notice's disclosure).
