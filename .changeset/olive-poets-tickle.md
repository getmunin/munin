---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
'@getmunin/agent-runtime': minor
'@getmunin/core': minor
'@getmunin/db': minor
---

Remove the agent-as-actor identity model.

The `agents` table has never held a row — nothing in the codebase inserts into it — and neither does anything set `tokens.agent_id`. `claims.agent_id` could only be written by a claimer whose actor id starts with `agt_`, which requires `tokens.agent_id`, so agent-held claims have never existed either. Conversation claims are an operator lock: they are taken only when a human sends a message, and read only to block the AI from replying over a human (`HandoverActiveError`). "The AI is handling this conversation" is modelled by `conv_conversations.agent_mode`, which is untouched.

Dropped: the `agents` table and its RLS policy, `claims.agent_id`, `tokens.agent_id`, and `ClaimManager` from `@getmunin/core` — a generic entity-claim helper keyed on agent id with no callers in this repo or munin-cloud. `ConversationClaimsService` keeps its full behavior for user claims.

`ClaimHolderType` narrows from `'user' | 'agent'` to `'user'`, which flows through the `/v1/conversations` claim DTOs, the `conversation.taken_over` and `conversation.released` webhook payloads, and `@getmunin/agent-runtime`'s claim type. The `'agent'` value has never been emitted, so consumers switching on it only lose a dead branch — but it is a type-level break, hence the minor bump.

The migration refuses to run if any of the above turns out to be false in a real database: it raises rather than dropping when `agents` has rows or either `agent_id` column holds non-null values.
