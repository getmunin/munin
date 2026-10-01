---
'@getmunin/chat-widget': patch
'@getmunin/backend-core': patch
'@getmunin/docs-pages': patch
---

Chat widget nudge: lifted pieces, and a compact form on phones.

- The nudge drops the eyebrow (org name · now). The dismiss button is now a round 32px chip floating above the message, and the message bubble and input field each carry a soft shadow, so the three pieces read as lifted off the page. The field uses the lighter rule border instead of the ink one.
- On phone-sized screens (600px wide or less, where the panel goes full-screen) the nudge shows only the message and the dismiss button; tapping the message opens the full-screen chat with the composer focused. The inline input was the piece that fought the on-screen keyboard over a fixed-position element, and it saved no steps on a phone since sending opens the full-screen panel anyway.
- On phones the nudge also steps aside once the visitor scrolls more than 60% of a screen away from where it appeared. That is not a dismissal: it is not snoozed and returns on the next page load.
- `skill://conv/setup-chat-widget` and the chat-widget docs guide describe the mobile behavior.
