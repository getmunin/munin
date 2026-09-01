---
'@getmunin/dashboard-pages': patch
---

Give the composer's action-failure banner an error tone instead of the accent one.

It rendered in cobalt with a pulsing dot, which said the wrong thing twice. Cobalt is
this dashboard's accent and, in the console, its live-state colour — so a failure was
drawn in the same hue as the send button directly beneath it, and "take-over failed" read
as something to act on rather than something that went wrong. The pulse claimed the
opposite of the truth: an action that already failed is settled, not in flight.

Now `text-destructive` with a static dot, matching `StatusLine`'s `tone: 'error'` in
`card-kit.tsx`, which is the dashboard's canonical dot-plus-label pattern and already
pairs the destructive colour with an unanimated dot. The dot stays `bg-current` so it
tracks the text, and `role="alert"` no longer ships an animation with it.

The load-failure hero loses its pulse for the same reason. Its colour was already right —
it uses the `alert-bad-*` token family meant for page-level alert surfaces — but a failed
load is just as settled as a failed action.
