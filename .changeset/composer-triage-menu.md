---
'@getmunin/dashboard-pages': patch
---

Give the conversation composer a "Mark as spam" action, and move the three destructive actions into one menu.

The composer's action row carried Send, Attach, Reject draft, Ask for a draft and Close-no-reply side by side, with no way to mark junk at all — an operator looking at an obvious spam thread could only close it, which settles the thread and tells Munin nothing about the sender. Meanwhile a second, mobile-only "more actions" menu sat up in the status strip holding Release and Restore draft, so the pane had two competing overflow menus depending on viewport.

There is now one menu, on every viewport, next to Send: Release, Restore draft (when you have edited the agent's text), Reject draft (when there is one), **Mark as spam**, and Close, no reply — the last three styled as destructive. The row itself is down to Send, Attach and Ask for a draft, and on mobile Send and the menu share a line instead of the menu stretching across its own.

Marking spam needs no confirmation dialog because it is reversible in one step: reopening the conversation restores it *and* clears the sender's spam flag.
