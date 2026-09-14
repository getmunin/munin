---
'@getmunin/backend-core': patch
---

Wire the `spam` conversation status the rest of the way, and stop the titling pass from clobbering a sender's own Subject line.

`changeStatus` treated only `closed` as a settled state. Marking a conversation `spam` left `needs_human_attention` set and the runner lease held, so junk kept counting toward the "needs your attention" badge and the agent kept holding a lease on a conversation nobody would ever answer. Both `closed` and `spam` now clear the attention columns, stamp `handover_resolved_at`, and release the runner. `POST /v1/conversations/:id/status` releases the operator claim for `spam` too, so marking junk never leaves it owned.

`conv_set_subject` now pre-checks the conversation's current subject and refuses with `conv_subject_exists` unless `overwrite: true` is passed. `skill://conv/set-topic-and-title` has always told the titling pass to leave an existing subject alone — email conversations carry the sender's own Subject header — but nothing enforced it, and a single misread would have replaced a real Subject with a generated summary irreversibly. Clearing a subject (`subject: null`) and re-setting the same value are both still unconditional.
