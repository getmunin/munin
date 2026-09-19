---
title: 'Social: Attach a picture or video to a post'
description: Put an image or video on a social post draft — including a file that exists only on somebody's machine, which goes through the CMS first — and understand when the file is read, what happens if it is gone by then, and why the asset needs a home rather than being left loose.
audiences: [admin]
---

# Attach a picture or video to a post

A post without a picture is a wall of text in a feed, and on LinkedIn nothing fetches one
for you: the Posts API refuses to read the page a link points at, so a bare URL in the body
renders as plain text with no card. Munin fills that gap in two ways, and knowing which one
is in play decides how much work you have to do.

**A draft that links somewhere already has a picture.** At publish time Munin reads the
linked page, takes the image it advertises to the world (`og:image`), and uploads that with
the post. A draft carrying nothing but `body` and `linkUrl` goes out illustrated. You do
not have to do anything for this, and there is nothing to attach.

**Attach a file when you want a *particular* one** — a chart that makes the point, a clip
of the thing working, an image someone made for this post. That is what the rest of this
describes.

## Tools

- `social_set_post_draft_media` — attach or clear the media on a draft nobody has decided on.
- `social_create_post_draft` / `social_propose_post_set` — take the same `mediaUrl`,
  `mediaKind` and `mediaAltText` when the file is known as the draft is filed.
- `social_list_platforms` — the accepted types and size ceilings, under `media`.
- `cms_request_asset_upload` + `cms_complete_asset_upload` — put a local file somewhere it
  has a URL.
- `cms_upload_asset_from_base64` — the same thing for something small you already hold.
- `cms_upload_asset_from_url` — copy a file that is already on the public web into the CMS.

## What `mediaUrl` has to be

A public https URL that Munin can fetch **at publish time** — not now. The draft stores the
URL and nothing else; the bytes are read when somebody publishes, and streamed straight to
the platform. Two consequences worth holding on to:

- A URL that expires — a signed link good for an hour, a preview that dies with a deploy —
  is a draft that fails to publish tomorrow, long after you filed it.
- Munin never keeps a copy. Once the post is out, the platform holds its own; the draft
  keeps only the URL, for the record and for the preview in the review queue.

If the fetch fails at publish time, the publish is refused with `social_media_failed` and
the draft stays pending, deliberately: a post written around a picture is not the same post
without it. See `skill://social/publish-a-reviewed-post`.

## A file on somebody's machine

There is nothing to point `mediaUrl` at, so give the file a home in the CMS first. Which
route depends on size:

| Size | Route |
| --- | --- |
| Up to 100 KB | `cms_upload_asset_from_base64` — inline, one call, right for something generated in this conversation |
| Up to 50 MB | `cms_request_asset_upload` → PUT or POST the bytes yourself → `cms_complete_asset_upload` |
| Over 50 MB | Neither. `cms_asset_too_large`. The file needs a different public home |

The presigned route needs a runtime that can issue a raw HTTP PUT. If yours cannot, you
cannot do this step, and the honest answer to the operator is to ask them to upload the file
through the dashboard and hand you the URL — not to quietly file the draft without a
picture.

SVG is rejected by the CMS, and LinkedIn does not take it either.

Then attach the asset's public URL with `social_set_post_draft_media`. The review queue
renders it — an image inline, a video with a player — so the person approving the post sees
what will go out rather than a filename.

## An asset a draft is waiting on cannot be deleted

A social draft is not a CMS entry, so it does not appear under the `entries` half of
`cms_list_asset_usage`. It appears under `elsewhere`, and it counts: while a draft is
`pending` and points at an asset, `cms_delete_asset` refuses with `cms_conflict`, naming the
draft. A cleanup pass over "unused" assets will not quietly break a post that is waiting for
review.

The hold ends when the draft does. Publish it, dismiss it, or let it fail, and the asset is
free to delete — which is correct, because the platform copied the bytes when the post went
out. Deleting it then changes nothing about the live post.

Two things this does not cover: an asset uploaded for a post that was never filed as a draft
is genuinely unreferenced and will be deleted, and an asset stored outside the CMS is
nobody's business but yours. Name assets for the post they belong to and both stay
manageable.

## Video

Mp4, up to what `social_list_platforms` reports. Munin uploads it in parts, so a large file
takes a while and the publish call is slow rather than failing — do not retry it because it
seems stuck. LinkedIn then processes the video after accepting it, which is why a freshly
published video post can take a minute to look right on the platform.

## Alt text

`mediaAltText` is what a screen reader announces. Write it for an image that carries meaning
— a chart, a screenshot with words in it — and describe what the picture *says*, not that it
is a picture. An image that is pure decoration can go without. The platform stores it with
the post; Munin shows it under the preview in the review queue.
