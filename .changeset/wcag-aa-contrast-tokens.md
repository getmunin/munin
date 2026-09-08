---
'@getmunin/ui': minor
'@getmunin/chat-widget': minor
'@getmunin/dashboard-pages': patch
'@getmunin/docs-pages': patch
'@getmunin/backend-core': patch
---

Bring the palette up to WCAG 2.2 AA

Five token pairs failed AA where they actually meet in components. Measured against every
surface each token lands on, not just the one it was tuned against.

**Mute text.** `--munin-fg-3` (`#7E8590`) reached 3.56:1 on paper, 3.21 on paper-deep and
2.93 on bone — below even the 3:1 large-text floor — across 250 uses of `text-ink-mute`, 116
of them at `text-xs` or smaller, plus every `Label` and every `Input` placeholder. Now
`#5E646C` (4.71 on bone, its binding surface). Light and dark needed opposite moves: the
light value lands at 3.24:1 on ink, so dark gets its own `--munin-fg-3: #868D97`, which also
fixes a separate 4.26:1 failure on the dark `--secondary` sidebar that the old shared value
had. The chat widget keeps a literal copy of the same grey across 20 rules and moves with it.

**Field boundaries.** `Input` drew its edge with `border-rule-soft` (`ink / 0.09`, 1.20:1)
on `bg-paper` inside a `Card` that is also `bg-paper` — nothing identified the field, failing
1.4.11. Adds `--munin-rule-field`, which form controls use while cards, dividers and
hairlines keep the decorative 0.09 rule. Light mode takes the solid ink edge the chat widget
already shipped; dark takes `fg-on-dark-2 / 0.36` (3.06:1). The same override in the widget's
dark palette had dropped its own fix back to 1.50:1, and the focused border is identical to
the resting one, so focus rested entirely on the outline below.

**Cobalt.** `#0066FF` was tuned on paper (4.63:1) and used at 8.5–11px on paper-deep (4.17)
and bone (3.81). Now `#0059DE`, which also lifts paper-on-accent from 4.63 to 5.78.

**Widget brand colour.** `themeColor` arrives from the customer and was used raw as the active
send icon and as the only focus outline on the composer and card forms — amber `#F59E0B` put
those at 2.06:1. Adds `contrastFloor()`, which darkens or lightens along the colour's own hue
only until it reaches 3:1 against the surface and returns a passing colour untouched. Also
fixes `.launcher-badge`, which hardcoded `#fff` over the brand colour (1.30:1 on a light one)
instead of the contrast-picked `--munin-theme-fg`.

**Verdigris.** The counterparty hue is identity text in the widget, not only a fill: 4.38:1 on
paper and 4.04:1 on its own tint. Now `#1B7153`.

The widget's default `themeColor` tracks cobalt to `#0059DE` so the brand blue is one value
across the product rather than two that differ by a contrast fix. It is a fill with
`--munin-theme-fg` on top, so it passed either way — this is consistency, not a contrast
repair. The `data-munin-theme-color` docs and the `setup-chat-widget` skill move with it.

`readableOn()` guaranteed only a 4.21:1 floor, because best-of-two across ink and paper bottoms
out at their crossover. It now falls through to black or white — whichever the background
actually favours — when neither palette value clears AA, raising the floor to exactly 4.50:1,
verified by sweeping 132k backgrounds. Picking the extreme on the same side as the palette
winner is wrong near the crossover and was the first version of this fix.

`--destructive` went `#b53d3d` → `#b23b3b` to clear 4.48:1 on bone.

Unchanged and re-verified: every dark-mode pair outside the mute finding, both identity
bubbles, all button fills, the alert and invite pairs, and both focus rings.
