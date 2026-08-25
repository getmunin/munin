---
'@getmunin/docs-pages': patch
---

Restore the spaces that vanished after inline `<code>`/`<em>`/`<strong>` in the guide prose.

Seven guides rendered joined-up words — "Open _Choose tools_on the connection's menu", "must not
take an `email` or `customerId`argument", "**All spoofable.**Anyone can send mail". The space was in
the source; Next's bundled SWC dropped it. A multi-line JSX text run whose text contains an HTML
entity (`&rsquo;`, `&quot;`, `&lt;`, …) loses its *leading* space during the entity decode — the
trailing space survives, a single-line run survives, and the same source compiled with upstream
`@swc/core` keeps it, so this only shows up in a Next build. It reproduces on both 16.2.12 (OSS
`apps/web`) and 16.2.6 (cloud marketing), and there is nothing in the source to hint at it: the
paragraph looks correct.

Each of the 18 affected boundaries now carries an explicit `{' '}`, which compiles to its own string
child and is immune to the bug. Verified by compiling every `.tsx` in the repo with Next's SWC and
asserting no element child is followed by a text child that starts mid-word, and by diffing the
rendered text of the touched files against the same files compiled with an unaffected SWC. Only
`packages/docs-pages/src/guides/` was affected; nothing under `apps/web` hit the pattern.

One neighbouring defect fixed along the way, this one genuinely in the source: in the chat-widget
guide, `<code>"dark"</code>` ended a line and `pins the panel` began the next, so ordinary JSX
line-joining left no space at all.

Also gives a `docs-attrs` definition list breathing room before a following paragraph. On the
custom-MCP-server guide the "Provenance describes the turn happening right now" paragraph butted
straight against the `self_reported` row, reading as a fourth definition rather than prose.
