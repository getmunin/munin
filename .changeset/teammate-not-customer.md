---
'@getmunin/agent-runtime': patch
'@getmunin/core': patch
---

Stop the self-service bot from mistaking a human teammate's reply for a customer question.

When a human teammate replied in a conversation, their message was fed to the model as a `user` turn with only a weak `[human teammate]` text prefix — the same role as the end-user — so the model couldn't reliably tell its own colleague from the customer. It would answer a teammate's question to the customer as if it had been asked of the bot. A teammate's message now maps to the `staff` author type in `toRuntimeHistory` and renders as an assistant-side colleague (`role: 'assistant'`, `name: 'teammate'`) in `historyToChatMessage`, and the default system prompt now explains that teammate messages are on the bot's side and never questions for it to answer.
