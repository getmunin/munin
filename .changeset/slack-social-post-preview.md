---
"@getmunin/backend-core": patch
---

Slack review cards for social post drafts now show a short preview of the post (the first five lines, capped at about 400 characters) with a pointer to the full draft in Munin, instead of quoting up to 2,900 characters inline. The share link is labelled with its host and path, so the UTM query string no longer spills across several lines. The character count and the full link target are unchanged.
