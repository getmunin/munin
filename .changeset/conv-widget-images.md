---
'@getmunin/backend-core': minor
'@getmunin/chat-widget': minor
---

Let chat-widget visitors send images, and render the ones sent back to them.

Two new widget routes sit on top of the attachment store: `POST /v1/widget/attachments` hands out
a presigned target and `POST /v1/widget/attachments/:id/complete` confirms the bytes. Both go
through the same key-to-channel check and origin allowlist as ingest, and both pass the caller's
`sessionId` into `ConvAttachmentsService`, so a visitor can only complete an upload their own
session requested. `WidgetIngestMessage.attachmentIds` links completed uploads at send time via
`attachToMessage`, which re-validates ownership, conversation match and upload completion — a
client-supplied id is never trusted, and an id belonging to another session or another
conversation is refused rather than silently dropped.

A message may now carry attachments with an empty `body`; previously `body` was required, which
made an image-only message impossible to express. A message with neither is still rejected.

`GET /v1/widget/messages` returns an `attachments` array per message, so outbound agent and human
images render in the widget too. Realtime already signals only a `messageId` and the widget
refetches, so no gateway change was needed. A tombstoned attachment serializes as
`deleted: true` with null URLs and the widget shows a placeholder — a deleted image never
degrades into a broken one.

In the bundle, images can be attached from a composer button, pasted from the clipboard or dropped
onto the panel, are downscaled and re-encoded to WebP in the browser before upload, and render as
tappable bubbles with a lightbox. The downscale mirrors the dashboard's `prepareImageForUpload`
rather than importing it, because the widget ships as a standalone bundle.
