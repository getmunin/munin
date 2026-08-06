---
'@getmunin/dashboard-pages': patch
---

Stop the onboarding wizard clipping the focus ring on its inputs.

`Card` carries `overflow-hidden`, and `BARE_CARD` — which turns a card into a plain layout wrapper for the wizard — dropped the border, background and padding but kept the clip. With `px-0` in bare mode the input is exactly as wide as the card, so the focused input's `ring-1` box-shadow, which paints outside the border box, was cut off on the left and right while the top and bottom kept their full 2px. The effect was a focus outline that looked thinner on the vertical edges than the horizontal ones.

Bare cards clip nothing intentionally, so `BARE_CARD` now sets `overflow-visible`. This covers the workspace name, provider API key, models and website import steps.
