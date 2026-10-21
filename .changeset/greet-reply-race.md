---
"@getmunin/backend-core": patch
"@getmunin/agent-runtime": patch
---

Stop a late widget greeting from swallowing the agent's answer to the visitor's first message.

When a visitor typed before the opening greeting was stored, the greet run was aborted but still posted: it was inside the audit pass, which ignores the abort signal, and nothing re-checked the signal before posting. The greeting then landed after the visitor's message, and the reply run's post was rejected as `agent_reply_race`, a terminal skip, so the question went unanswered with no handover.

- Greet runs skip the audit pass, and every run re-checks its abort signal after the audit and before the greet fallback post.
- Greetings are posted with `greeting: true` and stored with `metadata.kind = 'greeting'`. The server rejects a greeting with `greet_superseded` once the end user has written, and the runner treats that code as a terminal skip.
- The `agent_reply_race` check ignores greetings, so a greeting can never block the reply to the message it raced.
