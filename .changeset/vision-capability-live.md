---
'@getmunin/agent-host': minor
'@getmunin/agent-runtime': minor
'@getmunin/dashboard-pages': minor
---

Read vision capability from the provider instead of a hardcoded model allow-list, and show it in the
model picker.

The allow-list was wrong on the day it was written — it classified `o1` and `qwen2.5-vl` as text-only,
both of which accept images — and every new model release would have widened the gap. It is gone.

The capability was already in a payload the host fetches. `models.service` calls `{baseUrl}/models`
and parses `context_length` and `pricing`; the same response carries OpenRouter's
`architecture.input_modalities` and Anthropic's `capabilities.image_input.supported`, and both are now
read into `ModelEntry.supportsVision`.

A managed provider supplies its own model list and never hits that endpoint, so `DEFAULT_PROVIDER_MODELS`
widens from `string[]` to accept `{ id, supportsVision? }` as well. Hosts passing bare strings keep
working unchanged and report `null`.

`null` means the provider did not say, and is treated as "attempt": the request goes out with images,
and if an undeclared model rejects it the turn is retried once without them, the model is remembered as
image-less for the life of the process, and the customer still gets a reply. Guessing pessimistically
would have silently blinded the agent on providers that simply do not advertise modalities — plain
OpenAI among them — and guessing optimistically would have failed the turn outright. A rejection from a
model the provider *declared* image-capable is not retried, so a real error is never masked.

The model picker now labels each option `(chat, vision)` or `(chat)`, from the same field the gate
reads, so the list cannot disagree with behaviour. An option shows no label when capability is unknown
rather than claiming text-only.
