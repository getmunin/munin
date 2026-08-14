---
'@getmunin/agent-runtime': minor
'@getmunin/backend-core': minor
---

`agentMode: 'draft_only'` now actually drafts on a support conversation

Until now `draft_only` and `off` were the same code path outside outreach: the conversation
runner bailed at `agentMode !== 'auto'`, so an email or SMS channel set to *Draft only ·
needs approval* produced no draft and no reply — the agent was simply silent. The only thing
that ever drafted was an outreach-originated conversation, via
`skill://outreach/draft-reply-email`. Both the dashboard channel dialog (`agentReplies.draftOnly`
in `en`/`nb`) and the `conv_configure_email_channel` / SMS tool descriptions already promised
human-approved drafts, so this closes a gap between the documented product and the runtime.

The runner now resolves a *delivery* per conversation instead of a boolean: `send` for `auto`,
`draft` for `draft_only`. A draft run does the identical work — prompt assembly, MCP tool
loop, knowledge-base and connector lookups, the audit pass — and then calls `setDraftReply`
plus `requestHandover` instead of `postAgentMessage`. The dashboard inbox already renders the
latest `draft_reply` message in an editable composer for a flagged conversation, so a teammate
edits and sends with no UI change.

Deliberate boundaries, each covered by a test:

- **Outreach conversations are untouched.** They carry an `outreachCampaignId`, have their own
  proposal review queue with evidence and no-unsubscribe-footer rules, and are drafted by the
  outreach curator. Two drafts per inbound would be worse than none, so the runner skips them.
- **No typing indicator and no greeting.** Nothing is being sent to the end user, so the widget
  must not claim someone is writing, and a proactive greeting nobody will read is not worth
  drafting.
- **Audit actions that end a thread are withheld.** `set_topic` and `mark_spam` still apply;
  `close_conversation` and `snooze_conversation` do not, because they would hide a conversation
  whose answer has not been sent from the person who still has to send it.
- **The retries-exhausted fallback flags a handover without its public message.** In `send` mode
  the customer gets "a teammate will follow up"; in `draft` mode nothing should reach them.
- **No recovery sweep.** `listConversationsAwaitingAgentReply` stays `auto`-only. It keys off the
  last *non-internal* message being from the end user, and a parked draft is internal — including
  `draft_only` there would redraft the same conversation every 30 seconds forever. A draft is
  produced from the inbound realtime event; if the runner is down when mail lands the
  conversation is just unanswered in the inbox, which is what a human-in-the-loop inbox is for.

One follow-on worth knowing: because drafting flags the conversation for attention, a human
sending the reply resolves that handover, which enqueues the existing `skill://kb/review-content`
curation pass. A `draft_only` inbox therefore feeds the knowledge base from every human-sent
answer. Candidates still require human approval before an agent can use them.

`skill://conv/setup-email-channel` documents the three modes and these boundaries.
