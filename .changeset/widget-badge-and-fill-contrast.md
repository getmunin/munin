---
'@getmunin/chat-widget': patch
'@getmunin/backend-core': patch
'@getmunin/docs-pages': patch
---

Keep the unread badge distinct from a custom launcher, and give mid-tone theme colours white text on filled buttons.

The launcher's unread badge was always filled with the theme colour. A site that set
`data-munin-launcher-color` to the same colour as its theme got a badge the same colour as the
bubble under it, separated only by the ring, so it stopped reading as a notification. With a custom
launcher the badge now takes the launcher's colours inverted — the icon colour as fill, the launcher
colour as the count, floored to 4.5:1 when an explicit icon colour sits too close. Over the default
ink launcher it stays on the theme colour. The ring around it is 1px instead of 2px.

Filled theme surfaces — the email-save button and the badge over the default launcher — now paint
`--munin-theme-fill`: the theme colour darkened by at most 12% when that is enough for paper text to
reach AA. A mid-tone such as `#4577F6` passed AA only with ink text (4.60:1), which read as muddy on
a primary button; it now fills `#3F6CE0` with paper text. Light brand colours (yellow, emerald,
coral, amber) are out of that reach and keep their exact colour with ink text. Outlines, focus rings
and the send arrow keep the configured colour unchanged.

The welcome CTA arrow now uses `--munin-theme-edge` rather than the raw theme colour, so a pale theme
still gets an arrow at 3:1 against the panel.

The chat-widget guide and the `setup-chat-widget` skill describe both colours accordingly, and no
longer claim the theme colour paints links and visitor bubbles, which it hasn't since the WCAG
palette pass.
