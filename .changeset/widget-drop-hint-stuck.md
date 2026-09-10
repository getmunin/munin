---
'@getmunin/chat-widget': patch
---

Clear the chat widget's drop hint when a drag leaves the panel without dropping.

The `dragleave` handler decided whether the drag had really left by inspecting `e.target`, but
`dragleave` fires on the element being left and bubbles, so the last event before the pointer exits
the panel almost always targets a descendant — a message bubble, the message list — not `.chat`
itself. The old guard read that as an internal move and returned early, leaving "Slipp bildet her"
covering the conversation until the next drag. It now keys off `e.relatedTarget`, the node being
entered: still inside `.chat` means an internal move, anything else (including `null` when the drag
leaves the window) hides the hint.
