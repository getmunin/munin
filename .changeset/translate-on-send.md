---
'@getmunin/backend-core': minor
'@getmunin/agent-runtime': minor
'@getmunin/agent-host': minor
'@getmunin/dashboard-pages': minor
---

Reply in your own language, and the customer gets it in theirs. In a conversation whose customer writes another language, the composer shows a "Translate to <language>" checkbox, on by default. You write and edit in your own language. On send, the reply is translated and the translation goes out, while what you wrote is kept as that message's translation, so the thread shows your own words and "Show original" shows what the customer received. Untick the box to send as typed; the button then says "Send in <your language>".

- `POST /v1/conversations/:id/messages` takes `translateFrom`, the language the teammate wrote in. The reply is translated into the conversation's `customerLanguage` before it is stored and delivered. If translation fails, nothing is sent (`conv_translation_failed`). If the customer's language is not known yet, the reply is refused (`conv_translation_unavailable`). Draft slots and the edited-draft stamp are checked against what the teammate wrote, not the translation. Only teammates can use it: an agent writes the customer's language itself.
- backend-core gains `MessageTranslatorRegistry`, a hook the in-process agent host fills in. It translates on the fast model, under the same metering and generate gate as chat replies.
- `POST /v1/conversations/:id/request-draft` takes `language`, which rides on `conversation.draft_requested`. The agent then drafts in that language instead of the customer's, so a draft asked for with translation on arrives in the teammate's language, ready to edit.
- A draft asked for in a given language is checked once more after the agent writes it. A cheap pass on the audit model rewrites it into that language when the agent slipped into the customer's, and answers `OK` (a few tokens) when it is already right. The audit is told the language is intentional, so it no longer flags a Norwegian draft to a Spanish customer as a mismatch.
- The composer shows what the agent is doing in the reply box itself, on the agent's cool tint. While it writes, the box carries "Writing draft" (or "Writing draft from your notes", with the notes folded behind Show) over three skeleton lines, then the text as it streams in. A finished draft is labelled "Draft · Reject" and stays tinted and editable; once edited, the tint goes and the label reads "Edited draft · Discard", which brings the agent's version back. Teammates who don't hold the conversation see the same skeleton, then the draft labelled "Draft · Preview". Reject and Restore move out of the actions menu into the label, and "Release" becomes "Release conversation".
- Clicking another composer action while one is in flight no longer briefly disables the rest, and a draft seen first on a phone-width window no longer shows an empty box after widening to desktop.
