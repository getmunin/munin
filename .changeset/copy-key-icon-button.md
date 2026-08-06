---
'@getmunin/dashboard-pages': patch
---

Make the API-key reveal dialog's copy control a fixed-size icon button.

The button was labelled "Copy to clipboard" and collapsed to a bare `✓` on success, so it shrank
from ~340px to ~70px on click and the key field snapped wider underneath it. It is now a square
icon button that swaps the copy glyph for a green check, with the label moved to
`title`/`aria-label` and an `aria-live` region announcing "Copied" — no reflow, and the key gets
the reclaimed width.

The key field is pinned to `h-9` to match the button exactly; it previously derived a 34px height
from `py-2` and sat 2px short. Moving the value into a `truncate` span means the field is no
longer its own overflow container, so it also carries `min-w-0 overflow-hidden` — without that it
cannot shrink below the key's intrinsic width and pushes the button outside the dialog.
