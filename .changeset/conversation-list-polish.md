---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
---

Polish the conversation list and composer after reviewing them on a real inbox.

**The filter surface is collapsed with a receipt.** The panel folds away and what stays is one mono line of what is currently applied — `SHOWING · STATUS · OPEN ×` `CHANNEL · CHAT ×` `CLEAR ALL` — one removable token per narrowed dimension. The count and icon come off the trigger, since the receipt says the same thing precisely instead of numerically, and `Clear all` moves out of the panel so it is reachable without reopening it. The panel itself moves below the header into its own shaded block with labels above each field, two columns and Topic spanning both. With nothing applied the page shows only a search box and a `Filters` button. The trigger takes its height from the search input via `items-stretch` rather than a hard-coded value, because the input's height is padding-and-font-driven and differs per breakpoint.

**The row's status line is one line, and it marks the row worth clicking.** Topic, agent mode and state now join into a single run (`BILLING & INVOICES · REVIEW · DRAFT READY`) instead of stacking two lines, so every row is at most three lines and the list scans evenly.

The badge itself changed ends. `No draft — you write it` was an instruction in a list you cannot act from, it reported an absence in the loudest colour the row has, and it was the fourth thing on the row saying "a human is needed" after the section header, the bold title and the dashed claim face. Meanwhile the one row type where a badge changes what you do — *a draft is waiting, this is an approve not a write* — carried no badge at all. So the slot now says `Draft ready`, agent-stopped is left to be inferred from context, and cobalt means one coherent thing: the agent has something for you. The conversation pane keeps its fuller `The agent stopped · 4d — nothing drafted`, which is where the reason and the age actually matter.

**Rows with no inbound message say so.** A conversation the customer has not written in rendered a blank line where the preview goes, indistinguishable from one whose preview was merely truncated away. It now reads a muted italic `No message` — which is every outreach thread we started and every widget conversation opened by a greeting.

**The note count is gone**, from the row, the `RowNote` component, the `ConversationQueueItem` DTO and the `COUNT(*) FILTER` that computed it. Nothing consumed it.

**Composer action row:** the attach button becomes a paperclip icon, the overflow trigger is an outline button matching the others' height, and on mobile Send, attach and `⋯` share one line. Only `Close, no reply` is styled destructive — `Reject draft` and `Mark as spam` are both reversible. `Release` is dropped from the menu on desktop, where it is already a text action in the status strip, and kept on mobile where that strip is hidden. The collapsed mobile footer's buttons drop from `h-12` to `h-11` so every primary button in the pane is the same height.
