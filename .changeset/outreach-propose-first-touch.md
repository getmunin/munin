---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
'@getmunin/docs-pages': minor
'@getmunin/types': minor
'@getmunin/db': minor
---

refactor(outreach): first-touch replaces "initial" on the public surface

`outreach_propose_initial_message` is now `outreach_propose_first_touch`, the campaign flag `autoDraftInitial` is now `autoDraftFirstTouch` (column `auto_draft_initial` → `auto_draft_first_touch`), and the three skills `skill://outreach/draft-initial-{email,sms,call}` are now `skill://outreach/draft-first-touch-{email,sms,call}`.

The three propose tools file the three proposal kinds (`initial`, `reply`, `followup`), but only the first carried a medium in its name — `_message` was filler to make `outreach_propose_initial` grammatical, and inaccurate besides: the tool also files the script for an outbound voice call, which is not a message. Its description now says "first-touch outreach draft", the neutral term the input schema already uses (`draftSubject` / `draftBody`). The campaign flag had the same defect: `autoDraftInitial` paired with `autoDraftReplies` put a bare adjective next to a noun, while the surrounding descriptions had already switched to saying "first-touch".

The weekly scheduled sweep follows: it is now `curator-outreach-first-touch`, reads `MUNIN_CURATOR_OUTREACH_FIRST_TOUCH_CRON`, and enqueues under the dedupe key `outreach-first-touch:scheduled`.

Internals that track the stored kind keep `initial`: the `outreach_proposals.kind` value and `OutreachService.proposeInitial`.

Breaking, with no aliases published:

- callers that hardcode `outreach_propose_initial_message`
- callers that send or read `autoDraftInitial` on `outreach_create_campaign` / `outreach_update_campaign` / `outreach_list_campaigns`
- callers that read the old `skill://outreach/draft-initial-*` URIs via `skills_read` / `resources/read`
- self-hosters who set `MUNIN_CURATOR_OUTREACH_INITIAL_CRON` — the old name is ignored and the sweep silently reverts to its weekly default, so rename it
- campaign JSON exported before this release fails `outreach_import` validation on the renamed field

Migration `0059_outreach_first_touch_rename` renames the column in place, so stored per-campaign values survive, and carries the persisted curator queue across. `job_uri`, `dedupe_key` and `source_event_type` are rewritten on every row — they point at things that were renamed, so history stays queryable and a pending row still dedupes against the next scheduled enqueue. `user_prompt` is rewritten only for `status = 'pending'` rows: the scheduler persists its prompt verbatim at enqueue time, so a queued job would otherwise wake up naming a tool and a skill that no longer exist, while a finished job's prompt is the record of what it was actually told. Every step is guarded and safe to re-run.
