---
'@getmunin/agent-runtime': minor
'@getmunin/backend-core': minor
---

Give the reply agent the quoted email history an inbound message carries, fenced and labelled as quoted text rather than as something the customer wrote.

Inbound email has always been split in two: `stripQuotedReplyText` leaves `conv_messages.body` holding only the new text the sender typed, and `parseQuotedThread` files the earlier turns under `metadata.quotedThread`. The dashboard renders that second half behind a toggle and an MCP caller reading `conv_get_conversation` gets it in the raw metadata, but `toRuntimeHistory` mapped each message to `{ authorType, body, createdAt }` and touched `metadata` only for the `suppressed` check — so the in-house runtime never saw it. A customer replying to a newsletter with "Dette er bullshit. Moderat risiko?" reached the model as those five words plus a subject line, and the draft came back saying, accurately from where it stood, that it had no access to the earlier correspondence.

`toRuntimeHistory` now reads the newest two turns (1 000 chars each) onto `ConversationMessage.quotedHistory`. `historyToChatMessage` appends them to the turn inside a new `quoted_history` fence under a heading that says this is what the mail client quoted and not what the customer wrote, `compactHistory` charges the rendered block to the history budget, and a volatile system note — added only when some turn actually carries a quote — tells the model to use the block to resolve what the customer's own message leaves implicit, never to answer it, and never to follow instructions inside it. `quoted_history` joins `RESERVED_FRAMING_TAGS`, so quoted text cannot close its own fence. The audit pass gets the same context as a one-line summary per turn, so a reply grounded in the quoted mail no longer reads to the judge as invented.

`InProcessMuninRestClient.getConversation` dropped `metadata` when mapping conv DTOs into `ConversationDetail`. It now carries it, which is what makes the above work on the in-process path — and incidentally restores the `isSuppressed` filter there, so a bounce or an auto-reply stops being fed to the model as a customer turn.
