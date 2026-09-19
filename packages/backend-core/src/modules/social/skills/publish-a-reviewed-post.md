---
title: 'Social: Publish a reviewed post'
description: Publish a social post draft through Munin from the calling person's own connected account, and handle the four ways it can refuse — no connection, a lapsed connection, a draft already decided, and a platform that rejected the post.
audiences: [admin]
---

# Publish a reviewed post

`social_publish_post_draft` posts a pending draft to the platform and records the post id
and permalink on it. The post goes out immediately, under a real person's name, and
Munin cannot recall it. Treat the call as the irreversible step it is.

## Publishing one variant dismisses the rest

A set is one post written several ways, so a decision on one variant is a decision on the
set: publishing (or marking posted) dismisses every other pending variant in the same
`setId`, with `superseded: variant <label> was published instead` as the reason. Nothing
crosses a set boundary, and a failed publish settles nothing — the set stays open.

So do not "publish the best two". If the operator genuinely wants several posts, file
them as separate drafts rather than as variants of one set.

## Whose account it goes out from

The caller's. Not the author of the article the draft was written about, and not whoever
the draft was meant for. Munin holds one grant per person per platform, and publishing
uses the grant belonging to whoever is calling — which is why a service key cannot
publish at all and gets `social_publish_needs_person`.

A draft carries no owner, by design. It used to carry a suggested author, which conferred
nothing and misled everyone who read it: the name on the draft was never the name the post
went out under. What a variant carries instead is its `variantLabel` — the angle it takes
— because choosing between variants is a question about the writing, not about who files
it. If you are acting for a person who has no connection, the post cannot go out under
someone else's name to compensate.

## Before publishing

Only publish a draft when the person you are acting for has said to publish *that* draft.
A drafted post is a proposal; approving it is a human decision. It happens in the review
queue in the dashboard, or — where the organisation has connected Slack — from the
approval card Munin posts for each pending draft (`skill://slack/connect-slack`). The
Slack button publishes from the connected account of whoever clicked it, exactly as this
tool publishes from the account of whoever calls it.

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
it and do not retry; say it needs reauthorizing.

A lapsed LinkedIn grant is routine rather than a fault. `social_list_connected_accounts`
reports `canRefresh: false` for most organisations, and that is correct: LinkedIn issues
a renewable grant only to approved Marketing Developer Platform partners, so an
organisation on the self-serve "Share on LinkedIn" product gets a 60-day grant with
nothing to renew it with. Those accounts lapse on a schedule and the person reconnects
from Settings → Integrations. Never report it as a misconfiguration, and never ask
anyone for a password or an access token — the authorize link in the dashboard is the
only way an account is connected.

**`social_conflict`** — somebody decided the draft first. Re-read it and report what
actually happened to it; do not file a replacement draft to work around it.

**`social_stale`** — the draft was revised after the publish was bound to it. Only a
caller that passes a fingerprint sees this (Slack's publish button does), and it means
the wording on the card is not the wording in the draft. Re-read the draft and publish
the text you actually mean to publish.

**`social_media_failed`** — the picture or video the draft names could not be fetched or
uploaded, so nothing was posted and the draft is still pending. The message says which URL
and why: gone, too large, a type the platform does not take, a host that does not resolve.
Fix the media with `social_set_post_draft_media` — or clear it, and the post goes out with
whatever the linked page advertises — then publish again. Munin refuses here on purpose: a
draft written around a picture is not the same post without it.

An image Munin found on the linked page by itself is treated differently. If that one
cannot be fetched, the post goes out as text rather than failing, because nobody asked for
that particular picture.

**`social_publish_failed`** — the platform itself refused the post. The draft is now
marked `failed` with the reason on it, and it is *not* pending any more, so a retry means
filing a fresh draft rather than calling publish again. Report the reason verbatim: it is
the platform's, not Munin's.

## The link comment

A draft with `linkPlacement: comment` is published in two steps: the post, then a comment
carrying the link. The post is what matters, so a refused comment does not fail the
publish — the draft is recorded as published and `commentError` on it says what the
platform answered. Read it back with `social_get_post_draft` after publishing such a
draft, and if a comment was refused, tell the operator plainly: the post is live, the link
is not under it, and somebody can add the comment by hand.

On LinkedIn this is the one call that depends on which product the organisation's app
carries. Munin uses the route that the self-serve "Share on LinkedIn" product allows;
an app restricted differently may answer `ACCESS_DENIED` here while posting perfectly
well. That is a property of the app, not of the draft, so do not retry it.

## When the post was published by hand

Use `social_mark_draft_posted` instead, with the permalink if you have it. That records
the draft as published outside Munin and settles the rest of its set, exactly as
publishing through Munin does. It changes nothing on the platform, so never reach for it
to paper over a failed publish — that would record a post that does not exist.
