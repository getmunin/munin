---
'@getmunin/ui': minor
'@getmunin/dashboard-pages': patch
---

`@getmunin/ui` had no styled `Checkbox` — every checkbox in the dashboard (send rules, privacy redaction, weekday picker, …) fell back to a raw native `<input type="checkbox">`, which renders as the browser's oversized default widget and clashes with the sharp-cornered, zero-radius look used everywhere else. Added a `Checkbox` built on `@base-ui/react/checkbox`, styled to match (`border-ink` square, `bg-ink` + check glyph when ticked, same focus ring as `Button`), and swapped it into `CheckboxRow` and the send-rules weekday picker.

Fixed as a sibling `<label htmlFor>` rather than nesting the control inside the label: a custom (non-native-looking) checkbox wrapped by a native `<label>` double-fires on click — the browser's own label-forwarding dispatches a second native click at the hidden input in addition to the one the control already handles itself, which can silently cancel the toggle. Keeping the label as a sibling element pointing at the checkbox's `id` keeps "click anywhere in the row" working without that failure mode.
