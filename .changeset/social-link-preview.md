---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

Show the linked page's real picture in the social post preview, instead of a "the page's own share image" placeholder.

`GET /v1/social/drafts/:id/link-preview` reads the draft's link with the same `fetchOpenGraph` the publish step uses, and returns the page's `og:image` and `og:title`. Results are cached in memory per URL (ten minutes on success, one minute on failure), and a page that cannot be read comes back as `readable: false` instead of an error. The browser could not do this itself: reading another site's HTML is blocked cross-origin.

The preview now draws what publishing actually sends. On both LinkedIn and Facebook, a draft with no attached file goes out with the page's image uploaded as the post's own picture and the link in the text — there is no title card on either network, so the LinkedIn mock's title strip is gone. The picture shows whether the link sits in the body or the first comment, since publishing attaches it either way. When the page advertises no picture, Facebook builds its own card from the link, and the preview shows that card with the page's real title. A note under the preview says which case applies, including a page that could not be read just now.

Also in the review pane: the decided social pane shows the share link as a read-only field like the pending pane does, the "a sketch of the layout" note is gone, and the "see more" ellipsis sits against the text.
