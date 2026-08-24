---
'@getmunin/backend-core': patch
---

Render message bodies mirrored into Slack as Slack mrkdwn instead of raw markdown.

Agent replies are written in markdown, but Slack's mrkdwn is a different dialect: it
reads `*bold*`, not `**bold**`, and has no link, heading or list syntax at all. The
bridge previously only HTML-escaped the body, so a mirrored reply showed literal `**`
around every bold span, `[label](url)` link pairs and `###` heading markers.

`markdownToMrkdwn` now converts before posting: `**bold**`/`__bold__` → `*bold*`,
`*italic*` → `_italic_`, `~~strike~~` → `~strike~`, headings → a bold line,
`[label](url)`/`![alt](url)` → `<url|label>`, bullets → `•`/`◦`/`▪` by nesting depth,
task items → `☐`/`☑`, and horizontal rules are dropped. Code spans and fenced blocks
are held aside so emphasis inside them survives untouched, and fence language hints
are stripped because Slack renders them as body text. Conversion covers mirrored
conversation messages (both the unfurled and author-labeled variants) and outreach
draft bodies in approval cards.

Body truncation is now link- and fence-aware: it backs off a cut that would land inside
a `<url|label>` span or a trailing HTML entity, and closes a fence left open by the cut.
