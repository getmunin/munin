---
"@getmunin/backend-core": patch
"@getmunin/agent-runtime": patch
---

A conversation a teammate has taken over no longer raises "Human attention needed". On a `draft_only` conversation the runner keeps drafting on each customer message after a claim, since #873 made that deliberate, but each run could still escalate: the model could call `conv_request_human`, and parking the draft flagged it for review. Every human reply clears the flag, so each new customer message paged the team again (in Slack, a fresh alert in the escalations channel) for a conversation someone already owned. A run that started before the teammate answered could also re-flag a question they had just resolved.

`requestHandover` is now a no-op while a user holds an active claim, covering every caller: the admin and self-service tools, `/v1/conversations/:id/request-handover`, and the runner's draft and retries-exhausted paths. While a human holds the claim, the runner also hides `conv_request_human` from the model and skips the review flag after parking a draft, so the claimer gets a usable draft instead of a deferral. Auto-send on a claimed conversation is still refused, as before.
