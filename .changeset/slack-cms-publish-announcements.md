---
'@getmunin/backend-core': minor
---

Announce CMS publishes in Slack, with a link to the rendered article.

Publishing an entry now posts a one-line announcement into Slack — the entry's title, its collection and locale, and a link to the live article. It rides on the existing `cms.entry.published` event through the `WebhookDispatcher` sink and the `slack_deliveries` queue, so scheduled publishes announce when the schedule worker promotes them, and a failed post retries with the same backoff as every other Slack delivery. No buttons: a publish is news, not a decision, so it is not an approval-style message and records no notification link.

Routing follows the pattern the approvals channel established: `slack_set_routing` takes a new `purpose: "content"`, and announcements fall back to the default channel when it is unset.

The article link needs a per-collection template, because Munin does not render the customer's frontend — the same reason `settings.previewUrl` exists for drafts. `settings.liveUrl` is its published-side sibling: `https://www.example.com/{locale}/blog/{slug}`, with `{slug}`, `{locale}` and `{collection}` percent-encoded on substitution. A template that doesn't resolve to an `http(s)` URL is ignored rather than throwing — an announcement is a side effect of publishing, and a typo in a collection setting must not fail the publish. Without a template the announcement still posts, just without a link.

Two supporting changes to the `cms.entry.published` payload, which webhook subscribers also see:

- `title` and `url` are now included — `title` reads the entry's `title`, `headline`, `name` or `heading` field (in that order) and falls back to the slug; `url` is the resolved `liveUrl` or `null`.
- `previousStatus` records what the entry was before the transition. Re-publishing an already-published entry is a no-op status change, and Slack skips it rather than announcing the same article twice; a static-site rebuild hook can use it the same way.
