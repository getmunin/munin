---
'@getmunin/db': patch
---

Make the embedding HNSW index creation in `kb.sql` and `cms.sql` opclass-aware.

Postgres `CREATE INDEX IF NOT EXISTS` parses and validates the operator class against the column type *before* the name-existence check fires, so once a deployment had switched the embedding column to `halfvec` (via `MUNIN_EMBEDDING_DIMENSIONS > 2000`), every subsequent `runMigrations` call errored with `operator class "vector_cosine_ops" does not accept data type halfvec` — even though the index already existed. That includes every `pnpm migrate` on container redeploy.

Wrap each index creation in a `DO` block that inspects `information_schema.columns` for the actual `udt_name` (`vector` vs `halfvec`) and picks the matching opclass (`vector_cosine_ops` or `halfvec_cosine_ops`). The result is identical for the default OSS schema (`vector(1536)`) and unblocks deployments running at `halfvec(dim)`.
