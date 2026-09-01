---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
'@getmunin/db': minor
---

Per-topic promote threshold, and a customer message on an always-human topic now asks for a human

The automation page hardcoded a 90% unedited bar for every topic, and the only way to
express a topic's policy was the Promote / Back-to-manual buttons. Topics now carry
`promote_threshold_pct` (default 90, so existing topics keep the current bar) and the page
gets an explicit mode selector — inherit, always human, drafts only, auto-send — plus a
threshold picker for the topics where the bar still applies. `conv_set_topic_automation`
and `POST /v1/conversations/topics/:id/agent-mode` accept `promoteThresholdPct`; omitting
it leaves the stored value alone, so changing mode never silently resets the bar.

Auto-send is a standing rule, not a one-time promotion. It is selectable at any time, and
the gate is evaluated at reply time on every reply: above it the agent sends unread, below
it the agent drafts and waits. A topic whose unedited share falls back under its gate
returns to drafting on its own, with no human action and no notification needed — which is
what the dialog copy ("below it, Munin drafts and waits for you instead") always promised.
`effectiveAgentModeSql` in `topic-auto-gate.ts` is the single definition, used by both the
conversation-detail read the runner decides from and the queue-list read the dashboard
labels from, so the row label and the actual behaviour cannot disagree.

That fold changes what reads mean, and the read-model tests are split to say so. A read now
reports two different things: `agentMode` is the gated, effective mode a caller should act
on, while `topicAgentMode` stays the mode an operator configured — the automation page shows
the second, the inbox row shows the first, and collapsing them back into one column would
break one of the two surfaces silently. The old single test asserted an `auto` topic reads
back as `auto` everywhere, which was the pre-gate contract and only passed because nothing
evaluated the threshold yet. It is now two: the override rule is tested with `off`, the one
class of mode the gate can never veto, and a second case pins the fold itself — an `auto`
topic with no review history reads `draft_only` while still naming `auto` as the topic mode.

Separately, a conversation on a topic whose effective agent mode is `off` could go silent
with nobody watching. `needs_human_attention` was only ever raised by the agent calling
`conv_request_human`, and on an `off` topic the agent never runs — so once a teammate had
replied (which clears the flag), a follow-up from the customer left the conversation
unflagged, unclaimed, and filed under "In progress", where it reads as though the agent
owns it. Inbound end-user messages now raise the flag when nothing else can answer.

The check runs on every inbound text path — widget, email, and the generic webhook channel
ingest — because those write `conv_messages` directly rather than going through
`sendMessage`. Voice is deliberately untouched: the vendor's assistant owns that response
loop. An already-flagged conversation keeps its original `needs_human_attention_at`, so the
"stopped 2h ago" age doesn't reset on every new message.

The automation console is rebuilt to the Munin Oversight design: a topic row now reads
topic / volume / approved-unedited / policy, with one Edit button opening a policy dialog
instead of inline selects and duplicated hold labels. The dialog offers four policies as
described radio rows — channel default, always human, drafts only, auto-send — plus an
≥85/90/95/98 gate that only appears for auto-send, and tells you whether that gate is
sending right now or still holding.

That table stops being a table on a phone. Four columns inside a 760px minimum meant the
page scrolled sideways at every phone width, so the policy — the one thing you came to
change — sat off-screen. Under `md` each topic stacks instead: name and description, then
the approved-unedited percentage with a label where the column header used to be, then the
policy and its Edit button on one line. The weekly-volume column and the percentage's
progress bar are dropped there rather than shrunk; volume is context for a decision, not
the decision, and a bar that restates the number beside it earns none of the width it costs.
Both are unchanged from `md` up, where the grid still holds.

New topics default to `draft_only` rather than inheriting the channel default: a topic
nobody has judged yet should draft, not auto-send. Inheriting stays available as a
deliberate fourth policy ("channel default"), so existing topics with no override keep
their meaning — nothing is backfilled.

A conversation you hold the claim on now stays in "Needs your attention" for as long as you
hold it. Previously it dropped to "In progress" the moment you replied, because the section
was gated on `endUserSpokeLast` — so the conversations you had personally picked up
scattered between two sections depending on who happened to have spoken last, and the ones
where you were waiting on a customer looked like the agent's work. A claim is a statement
that you own the outcome, not just the next message. A flagged conversation someone else
holds still sits in "In progress": it is theirs to finish.

`draft_only` now means what it says on a conversation a human has claimed: the agent drafts
on every new customer message, claim or not. Previously the claim check ran ahead of the
mode and skipped the agent entirely, so a topic set to drafts-only produced nothing the
moment someone took the conversation over — exactly when a suggestion is most useful — and
the only way to get one was the explicit "ask for a draft" button.

Auto-send is unchanged: the agent still refuses to *send* on a claimed conversation. The
claim gate now applies to delivery, not to thinking, so `delivery === 'send'` is what it
tests.

That change alone would have destroyed work. The composer seeded itself from an arriving
draft with `setReply(draft.body)` and no guard, so a draft landing while you were mid-reply
replaced your text silently. A draft now only fills an empty composer; anything you have
typed wins. The explicit ask-for-a-draft path still streams over the box, because there you
asked for it.

The console now shows when the agent is working on a conversation you didn't ask it to
draft. `ConversationQueueItem` gains `agentWorking`, read straight off the runner lease
(`runner_holder` plus an unexpired `runner_lease_expires_at`) that `tryAcquireConversation`
already writes — so it is the actual state of the runner, not a guess, and needed no new
event. Rows and the pane reuse the existing "the agent is drafting…" badge, and the queue
takes one extra poll 1.5s after an inbound message because the runner claims the
conversation just after the message event lands.

Only a draft you asked for locks the composer. Autonomous drafting shows the badge but
leaves the keyboard alone: taking the textarea read-only for the few seconds the model runs
would interrupt someone mid-sentence, which is the same reason a landing draft no longer
overwrites typed text.

The audit pass that runs after each agent turn now sees the conversation, not just the last
message. It previously received only the newest customer message plus the reply, and decides
from that whether to close the conversation, snooze it, mark it spam, or request a handover
— judgements that are close to unmakeable without context. A customer answering "Kult!!!!"
to a substantive answer read as a goodbye and the thread was closed under a reply that had
just asked "anything else?"; the same conversation had earlier been marked spam, because one
short line in isolation is indistinguishable from junk. The last 10 public messages now go in
as `[Conversation so far]`, fenced with `fenceUntrusted` since they are third-party text, and
the auditor is told to read a short reaction mid-thread as continuation rather than a
sign-off.
