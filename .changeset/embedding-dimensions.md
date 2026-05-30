---
'@getmunin/core': minor
'@getmunin/db': minor
---

Make the embedding vector dimension a deploy-time parameter.

`OpenAIEmbeddingProvider` now accepts an optional `dimensions` field that is sent in the request body (honored by `text-embedding-3-*` and Scaleway's `qwen3-embedding-8b`) and enforced on the response — Matryoshka-truncated and L2-renormalized if the upstream returns a larger vector. The factory reads `OPENAI_EMBEDDING_DIMENSIONS` and cross-validates against `MUNIN_EMBEDDING_DIMENSIONS` so a mismatched deploy fails at boot rather than corrupting the index.

`packages/db/src/schema.ts` reads `MUNIN_EMBEDDING_DIMENSIONS` (default 1536, range 32..4000). The embedding column is `vector(dim)` when `dim <= 2000` and `halfvec(dim)` above that, so deployments wanting near-native Qwen3 quality can pick `halfvec(4000)` and still index with HNSW. OSS defaults are unchanged — leaving the env var unset keeps the existing `vector(1536)` schema and 1536-dim provider.

OSS migrations stay pinned to `vector(1536)`; bumping the dimension requires a fresh database or a deployment-specific ALTER. Self-hosters on the default see no behavior change.
