---
'@getmunin/backend-core': patch
---

Slack outreach approval replies now quote the full draft body inline instead of a 200-character preview — Slack's own _Show more_ collapsing handles long drafts, so reviewing no longer takes a second click. The _View full draft_ button and its read-only modal are gone: drafting passes produce 30–200-word bodies that fit comfortably in one Slack message, and the rare draft that overflows the block limit is cut with a `(truncated)` marker pointing at the dashboard, where it can be edited as well as read.
