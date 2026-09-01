---
'@getmunin/backend-core': minor
'@getmunin/db': minor
'@getmunin/agent-runtime': patch
'@getmunin/dashboard-pages': patch
---

Oversight console polish round two. Handover reasons are now recorded as internal agent notes instead of system divider messages (`requestHandover` accepts `postSystemNote: false`, and migration 0086 deletes old draft-park dividers and converts reasoned ones to the note shape). The runner's draft-request mode survives transcripts that end with a staff turn, withholds `conv_request_human`, and reports failures as internal notes. The console gets the review-driven UI batch: two-phase Thinking/Writing composer states with a locked input, per-action button spinners, auto-growing textareas, a compact mobile composer that expands to a full-screen editor, shallow conversation selection (no list remount flash), subject-first pane header, sticky settings rail, and the on-duty roster card removed.
