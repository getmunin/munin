---
'@getmunin/dashboard-pages': patch
---

Split the oversight composer's action row by the object each action acts on.

The row had grown to five controls (six with "ask for a draft") that answered three
different questions: verdicts on the conversation (send, close without reply),
operations on the draft (reject, restore, ask for a draft), and operations on the
claim (release). Restoring the agent draft is not even a conversation action — it is a
client-side undo of the reviewer's own edits, with no request behind it.

Release and restore now sit in the composer's status strip, each attached to the fact
it undoes: `yours · release` and `edited by you · restore draft`. Both were already
conditional on exactly the state that renders their label, so nothing new is gated.
The bottom row keeps only what ends the review — send, reject, close without reply —
which caps it at three controls. Closing without a reply used to be a smaller mono link
pushed to the far right; it is now a ghost button sitting with the other two, since it
is a verdict on the conversation like they are, and its weight rather than its size is
what marks it as the rarest of the three.

The strip states only what nothing else on screen already says. "Agent draft" and "no
draft" are gone: a pre-filled box under an "approve & send" button is a louder statement
that a draft arrived than a 9px label is, and an empty box with no approve button says
the opposite just as well. What is left is the transient run ("thinking", "writing") and
"edited by you", which is the one draft fact no button implies — and the fact that
"restore draft" undoes. Ownership states for conversations that are not yours are
unchanged. The queue row keeps its own no-draft badge, where triage does need it.

The hairline actions are desktop-only. On a phone the expanded composer puts release and
restore behind the ⋯ menu in its dialog header, next to close, leaving the strip as a
pure status line. Underlined 9px mono is a pointer idiom — it wants hover and precision,
and as a touch target it is far under the minimum — so the overflow that was wrong for
desktop, where there was room to show both actions outright, is right here. Nothing
becomes unreachable on mobile, which hiding them outright would have done: release now
lives only in that strip.

The whole strip is muted. Cobalt is left to the transient run only, where the pulsing
dot already earns it; a tinted "edited by you" sat directly above a cobalt focus ring
and a cobalt send button, and three blues stacked vertically read as three competing
claims on the eye rather than one hierarchy. The two hairline actions carry an underline
and hover to ink rather than cobalt, matching the state-label-plus-dismiss pair in
`inbox-conv-drawers.tsx` — in mono micro-text this dashboard uses cobalt for live state,
never for affordance.

"Edited by you" and its restore action are hidden together on the internal-note tab —
one condition drives both, so the label can never appear without the action it anchors.
There, the visible field is the note, so the label would have described something off
screen and restore would have silently rewritten it. The states that outlive the tab
switch — thinking, writing, unclaimed, owned by someone else, closed — still show.

"Reject" is now "Reject draft" — bare "Reject" did not say what it acted on, and it
sits next to "Send reply", which does.
