---
'@getmunin/backend-core': patch
---

An email the agent sends without a person approving it now only embeds images hosted by the deployment itself.

A markdown image in an outbound reply used to become an `<img>` for any `https` URL. The recipient's mail client loads images on open, so an auto-reply could carry data to any host named in an image URL — for instance when a forged message asks the agent to put the customer's order details into one. The email adapter now decides per message:

- **Written or approved by a person** — a teammate's reply, a draft a teammate sent from the dashboard (both stored with `authorType: 'user'`), or an outreach proposal a person approved: images from any absolute `https` host render as before.
- **Everything else**, including auto-replies, handover fallback messages and replies an API key sends from a draft: only images from the API base URL and the asset storage's public origin render, plus `cid:` attachments. Any other image is reduced to its alt text.

Quoted history always uses the restricted rule, so a teammate's reply can't re-send an image from an earlier auto-reply. Relative and protocol-relative image URLs no longer render in any email. Links are unchanged, and images customers send in are unaffected — they are stored as attachments, not rendered from markdown.

Outreach sends now stamp the message with `metadata.approvedOutreachProposalId`, which is how the adapter recognises them. `renderEmailHtml` takes `{ body, quoted }` options; each accepts `{ imageOrigins }`, and leaving `imageOrigins` out allows any absolute `https` image.
