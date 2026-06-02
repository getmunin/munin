---
'@getmunin/core': patch
---

Drop the misleading `openai` label from embedding-provider output.

The HTTP embedding provider is OpenAI-protocol compatible but routinely
points at Scaleway, Ollama, vLLM, etc. — calling its errors and telemetry
name `openai:…` made production failures look like OpenAI outages when
they were really upstream IAM/permission errors at the configured base URL.

- Error on non-2xx response is now `embedding provider request failed: <status> <body> (<name> via <baseUrl>)` instead of `openai embeddings failed: …`. The model name and endpoint are included so the failure is self-diagnosing.
- `EmbeddingProvider.name` no longer prefixes `openai:`; it's just `<model>` or `<model>@<dimensions>`. Anything consuming this for telemetry/audit will see the bare model identifier.
