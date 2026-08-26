---
'@getmunin/docs-pages': patch
---

Stop the docs pages from widening the viewport on phones.

Three rules in `docs.css` let content push the document past the viewport, which on iOS
Safari shrink-to-fits the whole page rather than scrolling the offending element:

- `.field-block` had no scroll container, so a REST parameter table (365px min-content)
  pushed `/docs/rest` to 410px inside a 390px viewport. It now scrolls on its own axis,
  matching how `.curl > pre` and `.docs-switcher` already behave.
- Inline `<code>` had no wrap opportunity, so a single long token — e.g.
  `window.mn.widget.identify(externalId, userHash)` in the chat-widget guide — measured
  311px inside a 280px column. `overflow-wrap: anywhere` applies to inline code only
  (`:not(pre) > code`), so scrollable code blocks are untouched: `white-space: pre`
  suppresses wrapping there regardless.
- `.docs-attrs dt` kept `white-space: nowrap` in the ≤720px single-column layout. That is
  right for short mono keys but not for the prose `dt`s in the
  skills-vs-tools-vs-rest guide, whose min-content was a whole 399px sentence.

Verified across 13 viewport widths (320–1024) on all 22 docs routes — 286 page-loads,
`documentElement.scrollWidth == clientWidth` everywhere. Desktop rendering is unchanged:
every rule either applies only below a breakpoint or only engages when content would
otherwise overflow.
