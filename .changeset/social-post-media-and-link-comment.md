---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
'@getmunin/db': minor
---

Social posts can carry a picture or a video, and can put their link in the first comment.

LinkedIn's Posts API does not scrape URLs — the docs say so outright — so the bare link we
appended to the commentary rendered as plain text with no card and no image. A picture has
to be uploaded as an asset and referenced by the post, which is what this adds: at publish
time Munin fetches the media, uploads it through the platform's own image or video API
(video goes up in 4 MB parts, ETags collected and finalized), and posts it as the content
of the post.

Where the media comes from has two answers. A draft that names nothing gets the image the
linked page advertises: Munin reads the page's Open Graph tags at publish time and attaches
`og:image`, so an existing draft with a `linkUrl` starts going out with a picture without
being re-filed. A draft that names `mediaUrl` gets exactly that file. The asymmetry is
deliberate in failure too — media the draft asked for failing to fetch refuses the publish
(`social_media_failed`, draft left pending), while a page's own image failing to fetch just
publishes the post as text, because nobody asked for that particular picture.

`linkPlacement: 'comment'` keeps the link out of the post body and publishes it as the
first comment instead, with optional `linkCommentText` for the wording. The post is the
part that matters, so a comment the platform refuses does not fail the publish: the draft
is recorded as published with `commentError` explaining what came back. On LinkedIn the comment is tried on the versioned
`/rest/socialActions` route first and falls back to unversioned `/v2` only when the
versioned one answers with a product gate (403/404/426), so an organisation whose app
carries the Community Management API uses the supported route and everyone else still gets
their comment.

Outbound fetches are guarded: http(s) only, DNS resolved and checked against private,
loopback, link-local and carrier-NAT ranges on every redirect hop, per-kind size ceilings,
and bounded redirects.

- New: `social_set_post_draft_media`, `social_set_post_draft_link_placement`.
- `social_create_post_draft` / `social_propose_post_set` take `mediaUrl`, `mediaKind`,
  `mediaAltText`, `linkPlacement`, `linkCommentText`.
- `social_list_platforms` reports accepted media types and size ceilings.
- The review queue previews the attached image or video and shows the comment the link
  will be posted as.
- New skill `skill://social/attach-media-to-a-post` covers attaching a local file through
  the CMS.
- A CMS asset a pending social draft points at can no longer be deleted. CMS gained an
  `AssetUsageRegistry` that modules outside it register with, so `cms_delete_asset` refuses
  with `cms_conflict` and `cms_list_asset_usage` now answers `{ entries, elsewhere }`
  instead of a bare array. The hold lifts as soon as the draft is decided — the platform
  has its own copy of the bytes by then.
- Existing drafts keep `linkPlacement: 'body'`, so nothing changes for a post already
  filed.
