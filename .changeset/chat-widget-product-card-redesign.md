---
"@getmunin/chat-widget": patch
---

Redesign the product cards in the chat widget. The image now fills the top of the card edge to edge, the price sits on the image as a small label, and the card has its own surface (`--munin-paper-deep`) so it no longer blends into the conversation background in light or dark mode. The "View" pill is gone: the whole card was already the link, so a small ↗ arrow next to the product name now marks it as opening the store page, and on hover or keyboard focus the arrow darkens and nudges along with the card border. Long product names are capped at three lines so one title can't stretch the whole rail, and the now-unused `productViewLabel` string is removed from every locale.
