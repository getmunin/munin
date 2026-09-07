---
'@getmunin/dashboard-pages': patch
---

Align the dashboard's two list sections with each other, and the relay forwarding address with the form it sits in.

- **Waiting rows now match conversation rows.** `ReviewRow` had drifted from `ConversationRow`: a flex row instead of the `[52px_minmax(0,1fr)_auto]` grid (so titles started at a different x), a 15px title against 14px, a `text-ink-mute` second line against `text-ink-soft`, and an `uppercase` age that rendered `6D` next to the conversations' `3h`. Stacked on the overview page the two sections read as two different components; they are now one row shape with one type scale. `ReviewRow` also backs the Review page's waiting tab, so that list picks up the same shape.
- **Dropped the "Munin will generate an address under … when you save" line.** It only ever appeared in the create dialog, promising a value the form was about to produce anyway; the address then shows up as a real field on the channel afterwards.
- **The forwarding address reads as a form field.** `CopyField` gains a `field` variant — form-input chrome (`rounded-input`, `border-rule-soft`, `bg-paper`, matching height and padding) instead of the heavy ink-bordered plate — and `CopyableSecret` passes the hint through `dialogHintClass` in that variant. The plate stays the default: in the one-time reveal dialogs (tracker keys, widget keys, invite links) the emphasis is the point. Only the inline relay field opts in.
