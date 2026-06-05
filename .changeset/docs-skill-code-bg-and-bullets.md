---
'@getmunin/docs-pages': patch
---

Restore list bullets inside `.docs .markdown` (Tailwind preflight in `apps/web` was zeroing out `list-style` on every `<ul>`/`<ol>`, leaving skill articles' list items as a mysteriously indented block with no marker). Now `disc` for unordered and `decimal` for ordered.

Also moves inline `<code>` and `<pre>` backgrounds from `--docs-page` (the bone/beige page background) to `--docs-card` (paper white), so code reads distinctly against the article body in both light and dark mode.
