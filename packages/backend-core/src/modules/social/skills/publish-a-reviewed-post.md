---
title: 'Social: Publish a reviewed post'
description: Publish a social post draft through Munin from the calling person's own connected account, and handle the four ways it can refuse — no connection, a lapsed connection, a draft already decided, and a platform that rejected the post.
audiences: [admin]
---

# Publish a reviewed post

`social_publish_post_draft` posts a pending draft to the platform and records the post id
and permalink on it. The post goes out immediately, under a real person's name, and
Munin cannot recall it. Treat the call as the irreversible step it is.

## Whose account it goes out from

The caller's. Not the draft's `suggestedUserId`, not the author of the article the draft
was written about. Munin holds one grant per person per platform, and publishing uses the
grant belonging to whoever is calling — which is why a service key cannot publish at all
and gets `social_publish_needs_person`.

So `suggestedUserId` tells you who *should* pick the draft up. It confers nothing. If you
are acting for a person who has no connection, the post cannot go out under someone
else's name to compensate.

## Before publishing

Only publish a draft when the person you are acting for has said to publish *that* draft.
A drafted post is a proposal; approving it is a human decision, and the review queue in
the dashboard is where it normally happens.

Check `social_get_post_draft` first when you did not just read it:

- `status` must be `pending`. Anything else means it was already decided.
- `canPublish` tells you whether Munin can post to that platform at all.
- `bodyChars` against `maxBodyChars` — a draft revised since it was filed may no longer
  fit.

## The four refusals, and what each one means

**`social_no_account`** — the caller has never connected an account for this platform.
Nothing is wrong with the draft. Say that publishing needs a connection, made from
Settings → Integrations, and leave the draft pending.

**`social_reconnect_required`** — a connection exists but has lapsed or been revoked.
Munin has already raised an alert for that person and emailed them. Do not try to repair
it and do not retry; say it needs reauthorizing. A lapsed LinkedIn grant is routine
rather than a fault — see `skill://social/route-a-post-to-a-person`.

**`social_conflict`** — somebody decided the draft first. Re-read it and report what
actually happened to it; do not file a replacement draft to work around it.

**`social_publish_failed`** — the platform itself refused the post. The draft is now
marked `failed` with the reason on it, and it is *not* pending any more, so a retry means
filing a fresh draft rather than calling publish again. Report the reason verbatim: it is
the platform's, not Munin's.

## When the post was published by hand

Use `social_mark_draft_posted` instead, with the permalink if you have it. That records
the post as published outside Munin and settles the rest of the set. It changes nothing
on the platform, so never reach for it to paper over a failed publish — that would record
a post that does not exist.
