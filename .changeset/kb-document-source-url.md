---
'@getmunin/backend-core': minor
'@getmunin/agent-host': minor
'@getmunin/core': minor
'@getmunin/db': minor
---

A KB document's canonical URL is now a field, `sourceUrl`, instead of a tag only the website importer could read.

The importer recorded where a page came from as a `source-url:<url>` tag — a convention private to `web-import.handler.ts`. Nothing else could use it: `kb_search` returns no tags at all, so an agent that wanted to link a customer to the page behind an answer had to fetch each cited document separately, and prefix-parsing a jsonb array is not a contract worth teaching a model. `kb_search`, `kb_get_document`, `kb_get_document_by_slug`, `kb_list_documents`, `kb_export` and `kb_import` now all carry `sourceUrl`, and `kb_create_document` / `kb_update_document` accept it — validated as an absolute http(s) URL, capped at 2048 characters. On update, omitting it keeps the current value and `null` clears it. It is provenance rather than content, so it is not versioned: `kb_restore_version` leaves it alone.

This generalises past website import. A hand-written document can now point at the canonical help-centre page it mirrors, which the tag convention could not express because nothing but the importer read tags.

The website importer writes the field and stops writing the tag. `candidateUrls` — the re-crawl and prune path — reads the field first and falls back to the tag, so documents imported before this keep revalidating correctly whether or not the backfill has run. Migration `0081_kb_document_source_url` adds the column and lifts existing tags into it (under `app.bypass_rls`, since `kb_documents` is FORCE RLS and the app role is not a superuser). The tag itself is left in place; the next re-import rewrites tags without it.

The seeded system prompt now tells the agent to link to `sourceUrl` when a document it used has one, and never to assemble a URL itself. Orgs created before this keep the prompt they were seeded with — patch `agent-runtime/system-prompt` per org to pick up the new wording.
