---
'@getmunin/dashboard-pages': patch
---

Drop the circular warning icon from the consent denial pane.

The pane already opens with a serif headline naming the resource that can't be authorized, so the icon above it restated the tone without adding information. Removing it leaves the headline as the first thing read; the surrounding `gap-4` column keeps the spacing it already had.
