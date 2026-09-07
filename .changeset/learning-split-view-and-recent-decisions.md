---
'@getmunin/dashboard-pages': patch
'@getmunin/backend-core': patch
---

Rebuild the Learning page as a persistent split, and show recent decisions under the queue.

The page was a single scrolling column of cards, each carrying a proposal's full body
and its own publish/dismiss pair. Reviewing the fourth proposal meant scrolling past
three complete articles, and there was no way to hold one open while looking at the
list. It now uses the same index-and-reading-pane split the conversation queue already
established: proposals on the left as compact rows (kind, title, target space, age), the
selected one on the right as the working surface, with the action bar pinned to the
bottom of the pane rather than trailing the body.

Selection lives in the URL — `/dashboard/learning/:id` — pushed shallowly the way the
conversation queue does it, so a proposal can be linked to and the back button walks the
review. On desktop the first row is selected automatically on arrival, via
`replaceState` so that auto-selection does not become a history entry the back button
has to climb over. On a phone the list and the pane are mutually exclusive, and arrival
still lands on the list: jumping straight into a full-screen proposal would skip the
browse step that makes the queue legible. A routed id that is no longer listed falls
back to the list instead of rendering an empty pane, which also means publishing or
dismissing moves you to the next proposal rather than leaving you on a dead one.

The page also only ever showed what was waiting. Everything already ruled on vanished,
which made "every edit teaches" hard to believe, since the record of what was taught was
the one thing not on screen. Decisions from the last seven days now sit in a second
section of the same list, below the open proposals, over the existing
`GET /v1/kb/curation/decisions`. One list rather than tabs, because the two are read
together — what is waiting, and what just happened to the neighbouring articles — and a
tab would have hidden the half that gives the other its context. The window keeps that
section from growing into an archive the queue has to scroll past; older decisions are
still available through the API and the MCP tool.

Decided rows are attributed: `CurationDecisionDto` gains `decidedByName`, resolved by
left-joining `users` on `decidedByActorId` when the decider was a person, the way
conversation claims already resolve `holderName`. Agent decisions carry a null name and
render as "Agent" — the actor type drives that label, not the absence of a name, so a
person whose record no longer resolves reads as "Unknown" rather than being misattributed
to the agent. Decided rows also carry the queue's scroll-linked fade, so the section
reads as settled history until you scroll to it.

The decided pane shows what was actually decided, not just that something was. A
published decision loads the article it produced — `kb_curation_decisions` keeps
`published_document_id`, and a new `GET /v1/kb/documents/:id` fetches it on selection —
and renders the body in the same reading treatment as a proposal. Without it the pane
was four lines of metadata under a headline, which is a poor argument that every edit
teaches: the one thing missing was what got taught. The body is rendered verbatim rather
than through the proposal pane's `stripLeadingHeading`, which exists because candidates
tend to repeat their title as an H1; a published article has no such guarantee, and
stripping would silently eat a real opening section heading.

Dismissed decisions say plainly that the text is gone rather than showing an empty
panel. Dismissing hard-deletes the candidate and its versions cascade with it, so the
decision row's `title` and `reason` are all that survive — an asymmetry worth stating in
the UI instead of leaving the reader to wonder what is missing.

Corrections, the third section in the original design, is deliberately absent. Its rows
mixed direct edits to published documents with rejections of proposals, and the latter is
what the decided section already covers; the two would have double-counted. A feed of
direct KB edits is a separate surface over `kb_document_versions`, not a variant of this
one.

Publish and dismiss are unchanged in behavior but now match the conversation composer's
button sizing, including the 44px touch target on mobile. Both panes take that pane's
horizontal padding too, and the source-conversation link drops cobalt for the muted
hairline treatment the composer's status actions use — in this dashboard's mono
micro-text, cobalt marks live state, not every link.

The section label both list columns use is now one `ConsoleSectionLabel` rather than a
copy in each page — the copy is what let them drift in the first place. It gains a rule
below it, and its padding is even top and bottom: the original `pt-4 pb-2` leaned the
label toward the rows beneath it, which reads as grouping while the label floats, but as
a misaligned box once it has a border. The conversation queue picks up both changes.
