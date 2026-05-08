---
'@getmunin/agent-host': patch
---

fix(agent-host): use native auth for Anthropic /v1/models

Anthropic's OAI-compat shim accepts `Authorization: Bearer ...` for
`/v1/chat/completions` but not for `/v1/models` — that endpoint
requires the native `x-api-key` + `anthropic-version` headers.

`AgentModelsService.fetchModels` now picks headers based on the
provider URL: `x-api-key` + `anthropic-version: 2023-06-01` when the
URL is `api.anthropic.com`, Bearer otherwise (OpenRouter, OpenAI,
custom OAI-compat endpoints).
