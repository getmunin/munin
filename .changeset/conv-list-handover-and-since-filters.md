---
'@getmunin/backend-core': patch
'@getmunin/db': patch
---

Let `conv_list_conversations` express the curation sweep's eligibility rule.

`skill://kb/review-content` told the sweep agent to scope to "the last 7 days of resolved handovers" and to pass `since` to `conv_list_conversations`. That tool had no `since` and no handover filter, so both rules were prose the agent could skip — and on 2 August the weekly sweep skipped both, drafting KB candidates from six-week-old conversations that never had a handover at all.

Worse, the field the skill named as the handover signal does not survive the handover. It claimed `needsHumanAttentionAt` "is set whenever the conversation was *ever* flagged, even if the flag has since been cleared". Both clear paths — a non-internal staff reply, and closing the conversation — set `needsHumanAttention = false` **and** `needsHumanAttentionAt = null`. A resolved handover was indistinguishable from a conversation the agent handled alone.

`conv_conversations.handover_resolved_at` is stamped when the flag clears (only for rows that were actually flagged) and nulled when a handover is re-requested. `conv_list_conversations` gains:

- `handover: 'active' | 'resolved' | 'never'` — waiting on a human, answered and cleared, or no handover on record.
- `since` — ISO 8601; keeps conversations whose `lastMessageAt` is at or after it. A malformed value is a `conv_invalid` error, not a 500.

`handoverResolvedAt` is on the conversation DTO. It is null for everything resolved before this migration — there is nothing to backfill, since the timestamp was being erased — so old conversations do not appear under `handover: 'resolved'`. The skill says so, and the sweep prompt now names the exact call.
