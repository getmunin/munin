---
'@getmunin/dashboard-pages': minor
---

Give unrouted URLs a Munin 404 instead of the stock Next.js one

`NotFoundPage` renders the house grammar — eyebrow, serif headline with the cobalt
emphasis, lede, and a way back to the front page — so a mistyped or stale link lands
somewhere that looks like the product. It is exported from the shared package so every
app that consumes it gets the same page from the same copy.

The apps mount it at two boundaries, because Next uses them for different things:
`[locale]/not-found.tsx` renders for a `notFound()` thrown inside the locale tree and
for unmatched URLs under a locale prefix, in that request's language; `global-not-found.tsx`
(behind Next's `globalNotFound` flag) covers everything else, where no locale is known
yet, and must ship its own `<html>` because it bypasses the layout. Both answer a real
404 status.

The same shell backs the "this belongs to another workspace" screen, so the two
standalone surfaces cannot drift apart again: both render logo, eyebrow, serif
headline with the cobalt emphasis, lede, and one action, from one component.

