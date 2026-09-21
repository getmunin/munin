---
'@getmunin/dashboard-pages': minor
---

Show a social draft as the post it will become, not just as text.

The social review pane now opens on a "Preview" tab — the CMS pane's own wording — that
renders the draft the way LinkedIn and Facebook lay a post out: the posting account with its initials,
the body folded behind the network's own "see more" (LinkedIn folds far earlier than
Facebook), the attached picture or — when the post carries only a link — the placeholder
card whose picture and title the linked page supplies at publish time, the network's
action row, and the first comment when the link is placed there. The old text view moves
to a second "Fields" tab — CMS's wording again — where the share link is now a read-only
input, so it lines up with the post and comment boxes above it.

The connect-your-account nudge and the two footer links come out with it: the pane already
says what will happen in its footer button, and Settings → Integrations is where an account
gets connected.

The tabs are the CMS pane's own, lifted out of `cms.tsx` into `shared.tsx` and reused
verbatim — the same underline row the CMS draft preview has used all along.

Two details the preview is careful about. It places the link the way each adapter does
rather than the way the draft stores it: LinkedIn's `composeCommentary` always appends the
URL to the commentary, so the preview shows it in the text and lets the unfurl card stand in
for it; Facebook's `composeMessage` appends it only when a picture rides along, so a bare
link post shows the card and no URL in the text. And the preview paints itself in fixed
platform colours under `munin-light-locked` — a preview that flips to the dashboard's dark
theme stops being a preview of anything.
