---
'@getmunin/agent-host': minor
'@getmunin/dashboard-pages': minor
---

Show a model's name in the picker, not just its id.

The picker rendered the raw model id, so a deployment offering built-in models could only
present them as `gpt-oss-120b` and `qwen3.5-397b-a17b` — accurate, and unreadable to the
person choosing. `ModelEntry` gains a `label`, and `formatModel` uses it as the head of the
option while pushing the id into the detail line beside context length and pricing, so the
list reads `GPT-OSS 120B (chat) · gpt-oss-120b · 128k ctx`. The id stays visible on purpose:
it is what actually goes to the provider, and it is what an operator matches against the
provider's own catalogue.

Two sources fill it, mirroring how `supportsVision` is resolved:

- **The host**, through `AgentHostModule`'s `defaultProviderModels`: `ProviderModelOffer`
  gains an optional `label`, so `{ id: 'gpt-oss-120b', label: 'GPT-OSS 120B' }` names a
  managed model. Bare strings keep working and report `null`.
- **The provider's own `/models` payload**, which already carried the name the host was
  hardcoding. OpenRouter returns `name` ("Anthropic: Claude Haiku 4.5") and Anthropic
  returns `display_name`; `readModelLabel` reads either. Plain OpenAI returns neither, so
  those entries keep showing the id — which is what its own docs call them anyway.

The picker's sort moves from the id to the displayed name (`modelSortKey`), because a list
labelled with names but ordered by hidden ids looks arbitrary. `value` on each option is
still the id, so nothing about what gets saved or sent changes.
