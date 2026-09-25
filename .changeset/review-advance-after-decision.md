---
'@getmunin/dashboard-pages': minor
'@getmunin/ui': patch
---

Deciding an item on the review page now opens the next waiting item instead of jumping to the Decided tab with the same item still open. The next item's pane rises into place (or drops, when the list moved up), and a confirmation sits above it — `APPROVED · POSTED TO FACEBOOK` over the item's title, a View link to it in Decided, and a bar along the bottom that counts down the six seconds before it goes. Hovering or focusing the notice pauses the countdown. When the queue is clear the notice sits above the empty state instead. Reduced-motion users get the instant switch; the countdown bar stays, since it is what dismisses the notice.

The jump came from decided items sharing their id with the queue item they came from: once the Decided list reloaded, the still-open URL resolved to the Decided tab. The page now starts a hand-off from the decided id to the next one the moment you decide, and follows it as soon as either the approval returns or the item leaves Waiting — realtime usually reloads both lists before the approval request itself resolves — so the order in which the queue reload, the Decided reload and the URL change land no longer matters. Only your own decisions advance the page — when someone else decides the item you have open, it still shows as resolved, with who decided it.

Scheduling (an outreach send time or a CMS publish time) advances the same way.

`@getmunin/ui` gains the keyframes behind this in `tokens.css` (`animate-arrive-down`, `animate-arrive-up`, `animate-notice-in`, `animate-notice-timer`). They are plain CSS rather than `tw-animate-css` utilities: the dashboard builds with Tailwind v3, which never generates that v4 plugin's `animate-in` / `slide-in-*` classes.
