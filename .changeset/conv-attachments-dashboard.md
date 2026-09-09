---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

Wire conversation image attachments through the operator surfaces: the read path, `conv_send_message`,
the dashboard composer and thread pane, and deletion from both the UI and MCP.

The read path is the piece the rest of the stack was waiting on. `conv_get_conversation` and the
`/v1/conversations/*` DTOs now mint attachment URLs per request via `hydrateProjection`, so the
denormalized `conv_messages.attachments` column stays free of expiring tokens while readers still get
a working link. Without this the in-house agent runner received `url: null` for every image and could
only ever see a text placeholder.

`conv_send_message` and the reply endpoint take `attachmentIds`, which reference images already on the
conversation. There is deliberately no tool that uploads bytes to a conversation: an agent can send a
customer's own photo back with an annotation, but cannot introduce a new file onto a channel that
reaches customers. Ids from another conversation, ids already committed to a different message, and
deleted ids are all rejected before the insert rather than at commit time.

Deleting an attachment also rewrites the `deleted` flag inside the message's projection. Tombstoning
only the `conv_attachments` row left the thread claiming the image was live, so the dashboard rendered
a broken image instead of the "removed" placeholder — the serve route correctly refused the bytes, but
nothing told the reader why.

Members gain three routes (attachment upload-request, complete, delete). A member who can already post
a reply should be able to attach an image to it and take one back down, and `member-surface.test.ts`
records the widening.
