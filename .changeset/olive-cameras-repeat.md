---
'@getmunin/backend-core': patch
'@getmunin/agent-runtime': patch
---

Make a `draft_only` topic hold the reply that is already being written.

The agent resolved its delivery mode once, before the LLM turn, and acted on it seconds later. Topic classification runs as a separate curator job, so a conversation whose topic had not landed yet fell back to the channel default — and a topic set to `draft_only` could be applied mid-turn and still not stop the send. On one live org `conv_list_topic_automation` showed `Support` as `draft_only` with `autoSent: 6`; one reply was delivered 62 ms after the note saying replies needed review.

`sendMessage` now re-checks the effective agent mode (topic override included) when the message is written, not when the turn started, and refuses a public agent send with `agent_send_not_auto` if it resolves to `draft_only`. The runtime catches that and parks the reply through its existing draft path — draft stored, superseding older drafts, flagged for review — so the generated answer is kept rather than discarded. Outreach conversations are exempt: they are created `draft_only` by construction, because outreach is propose-only and the approval step *is* the review, so gating an approved outreach send on the same flag would block every campaign send.

The check is server-side, so it also closes the window for an operator demoting a topic while a turn is in flight, and covers any caller, not just the in-house runner. Internal notes, operator sends, and approved drafts are unaffected.
