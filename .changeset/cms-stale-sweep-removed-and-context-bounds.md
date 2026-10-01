---
'@getmunin/agent-runtime': minor
'@getmunin/agent-host': patch
'@getmunin/backend-core': minor
'@getmunin/types': patch
---

The monthly CMS stale-content curator sweep is gone, and an agent run that outgrows the model's context window no longer reports the AI provider as down.

**CMS stale-content sweep removed.** `curator-cms-stale` enqueued `skill://cms/review-stale-entries` for every org on the 1st of each month, but its report was written to `curator_jobs.last_reply_text` and shown nowhere, so nobody could act on it. The skill stays and is now written for an on-demand review: an admin agent runs it when the operator asks and acts only on the items they confirm. `MUNIN_CURATOR_CMS_STALE_CRON` is no longer read, the skill is no longer a known curator job, and any such job still queued fails without retrying.

**`cms_list_versions` returns summaries.** It used to return every version of an entry with its full data and no size limit, so a few long, often-edited entries could fill a 128k-token context window by themselves. Versions now come back newest first with long text shortened to a lead and a word count in `fieldSummary`, under the same 30k-character budget as `cms_list_entries`, with `limit` (default 50, max 200) and `dropped` for versions left out. The new `cms_get_version` reads one version in full.

**Tool results are bounded inside an agent run.** A single tool result over 60k characters is truncated with a note telling the model to narrow the request. Once all tool results in a run add up to more than 160k characters, the oldest ones are replaced with a short placeholder (the newest is always kept whole), so a long tool loop can't push the prompt past the context window.

**A context-window overflow is a failure of that request, not of the provider.** A 400/413/422 whose message says the input exceeds the context length is classified as `provider_context_length`. It does not open the "AI provider error" alert, does not stop the curator queue, and is not retried, since the same input would overflow again. A conversation reply hands over after the first attempt instead of retrying three times, and an image turn that overflows no longer marks the model as unable to read images.
