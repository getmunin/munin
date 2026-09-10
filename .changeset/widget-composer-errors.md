---
'@getmunin/chat-widget': patch
---

Make the widget's composer error behave like the dashboard's, and stop losing failed sends in the
console.

The composer note was a bare red line that erased itself after five seconds, so the reason a file
was rejected disappeared while its error chip stayed on screen. It is now a dismissible alert — dot,
message, Close — carrying `role="alert"` so assistive tech announces it, and it persists until the
visitor dismisses it or sends the message. A message that fails to send used to be `console.warn`
only, invisible to the visitor; it now surfaces in the same note.

The attachment chip's remove control also picks up the dashboard's affordance — the same `✕` glyph
on a translucent paper pill in muted ink, instead of a filled dark circle with an SVG cross.
