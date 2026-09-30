---
'@getmunin/backend-core': patch
---

Outbound email replies no longer pass raw HTML through from markdown. The HTML part of a reply is rendered from the message body and the quoted history, and the quoted history includes what the customer wrote — so any HTML tags a customer typed used to go out as live markup in the org's own signed mail. Raw HTML in either part is now shown as literal text, and link and image URLs are limited to `http`, `https` and `mailto` (plus `cid` for images); anything else keeps its visible text but loses the link. This matches how the dashboard already displays the same messages. Ordinary markdown — emphasis, lists, links, code, line breaks — renders as before. The renderer also stops mutating the shared `marked` singleton.
