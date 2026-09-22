---
'@getmunin/dashboard-pages': minor
---

Send and publish failures render as one block in the composer and every review pane.

The conversation composer and the review panes had grown two near-identical error banners that then drifted apart — same markup, same dot, same Close link, differing only in colour token and whether a long message truncated. Both now render a single failure block: a 2px rule and tinted ground, monospace at 11px, the code-prefixed message with an attempt count, and a 16px dismiss in the corner. It sits inside the action container, sharing the bordered region with the buttons, rather than floating above it as a sibling with its own rule. The primary button relabels to "Retry send" / "Retry publish" in place.

A repeat failure replaces the block and bumps its counter instead of stacking. Two fixes were needed to make that work:

- Every setter cleared the error *before* the attempt, so the previous state was already gone when the catch ran and the counter reset to (1) forever. Clearing now happens once the call has actually succeeded.
- The composer bound the banner to the controller's error unconditionally, while all five review panes scope theirs by id. A failed send therefore showed its banner — code and count included — on every other conversation you opened. Now scoped to the conversation on screen, so it stays put and survives switching away and back.

The block is in-session state: it does not survive a reload, and dismissing clears the same state a reload would.
