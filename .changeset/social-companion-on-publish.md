---
'@getmunin/backend-core': minor
'@getmunin/types': minor
---

Draft companion social posts when a CMS entry is published.

A collection opts in with `socialDraftOnPublish: true` in its settings. The first
time an entry in it reaches `published`, an `EventSink` on `cms.entry.published`
queues one `skill://social/draft-companion-posts` pass, and a person finds a
labelled set of variants waiting. Opt-in is per collection because publishing is
not one kind of act: the same event fires for an article worth announcing and for
a team page nobody should post about.

Three conditions are checked in the sink rather than left to the drafting pass,
because each of them is a fact the database already knows and an LLM would have to
be told:

- **A republish is not a publish.** `previousStatus === 'published'` means somebody
  fixed a typo, so it queues nothing. A promotion off the schedule
  (`previousStatus === 'scheduled'`) does count, which is the whole point of
  scheduling an article.
- **No `liveUrl` template, no job.** The published payload already carries a
  validated http(s) `url` or `null`; a post with nothing to link to is not worth
  drafting, and this is cheaper to notice before the model runs than after.
- **An entry that already has a set does not get a second one.** The dedupe key
  only covers a job still pending, so a re-fired event after a successful pass
  would otherwise hand the reviewer eight variants of one article.

Both lookups filter on `org_id` explicitly rather than leaning on RLS. The
scheduled-publish path runs under `app.bypass_rls=on`, so a sink that trusted RLS
would read whichever org's `articles` collection the planner reached first — and
`cms_collections` is unique on `(org_id, slug)`, which means a shared slug is the
normal case, not a rare one.

`skill://social/draft-companion-posts` is registered in `TOOL_PREFIXES_BY_URI`,
which is the real sandbox for a curator run: the skill executes against a
full-admin MCP client, and `toolPrefixesFor` returning `undefined` means *no*
restriction rather than none needed. The pass gets `cms_get_entry`,
`social_list_platforms` and `social_propose_post_set` — enough to read the article
and propose, and nothing that decides a draft. Dismissing, revising and marking one
posted stay with the human and the agent working on their behalf.

Cloud follow-up: `AgentRunnerService.toolPrefixesFor` in munin-cloud needs the same
entry, in a separate PR after this release, or companion passes there run unsandboxed.
