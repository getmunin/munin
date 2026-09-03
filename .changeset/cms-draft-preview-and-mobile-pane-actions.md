---
'@getmunin/dashboard-pages': patch
'@getmunin/ui': patch
---

Reviewing a CMS draft now leads with the page itself. The drawer fetches the preview link as soon as the draft opens and embeds it in a sandboxed frame behind a Preview/Fields tab pair, with a direct "open on the site" link alongside. A frame that never paints — the site refuses to be embedded, or does not answer inside fifteen seconds — falls back to the field view with a marked tab, an explanation, and a retry, rather than leaving a blank rectangle. The old approach opened a blank tab first and navigated it after the link resolved, which browsers increasingly treat as a popup and which gave no signal when the preview failed.

Every review pane's footer now fits one line on a phone. The primary action stretches to fill the row and the rest collapse into a bottom sheet behind a single "more actions" button, replacing footers that stacked three or four full-width buttons and pushed the content out of view. On mobile the panes also drop their own headers and eyebrows, since the surrounding shell already names the item. CMS drawers gain the same load-failed and loading states the other panes have, and their padding matches the rest of the console.

Two visual corrections: the confidence, channel and kind badges in the review panes are `Pill`s rather than hand-rolled spans — which is what the new `fill="solid"` variant is for — and avatar chips use ink instead of cobalt, so cobalt stays the accent it is everywhere else.
