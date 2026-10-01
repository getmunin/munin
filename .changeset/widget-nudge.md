---
'@getmunin/chat-widget': minor
'@getmunin/backend-core': minor
'@getmunin/docs-pages': minor
---

Chat widget: an opt-in nudge above the closed launcher, plus launcher refinements.

- `data-munin-nudge` shows a short teaser after a delay: an eyebrow (org name · now), a message bubble, a dismiss button and an inline input. Leave the value empty for a localized default (all 21 bundled languages). Sending from the input opens the panel straight into a new conversation with that message as the first turn. The launcher badge reads `1` while it shows; real unread messages take precedence.
- It never appears once the panel has been opened or the current session already has messages, and a dismissal or open snoozes it for 7 days per channel (stored in `localStorage`).
- `data-munin-nudge-delay` sets the delay in seconds (default 8, 0–3600). The bubble defaults to a light tint of the theme color; `data-munin-nudge-color` sets it explicitly, with the text flipping between ink and paper for contrast.
- The launcher now follows `data-munin-corners`: square (the default) gives a square launcher, rounded keeps the circle. On the square launcher the unread badge sits centered on the corner; the badge is slightly larger and no longer has a border.
- Opening the widget when the visitor has no past or current conversation goes straight to a new chat instead of the welcome screen.
- `skill://conv/setup-chat-widget` and the chat-widget docs guide document the new attributes and `data-munin-corners`.
