# Conversation attachments contract

The store behind images on conversations, for both directions on every channel. PR 1 of the
image-support stack builds this trunk; the channel wiring (inbound email, outbound email,
widget, `conv_send_message`, agent vision) is built on top and must not re-invent any of it.

## Why this is not `cms_assets`

CMS assets are org **content**: publicly served under an unguessable-but-permanent URL, listed
by `cms_list_assets`, quota'd as content, expanded by the public delivery API. Conversation
attachments are private per-conversation data belonging to a contact: they cascade-delete with
the conversation, an end-user must only ever reach their own, and they must never appear in the
CMS library. Same plumbing (`AssetStorage`, `deriveVariantColumns`), different table.

## Storage and serving

- Bytes go to the injected `AssetStorage` (`STORAGE` token) under
  `conv/<orgId>/<conversationId>/<random>.<ext>` — never a CMS key.
- Nothing is served from a public URL. `ConvAttachmentsService.signUrl()` mints an HMAC token
  (`signAttachmentToken`, `@getmunin/core`) and `GET /v1/c/a/:token` streams the object after
  re-loading the row. `?w=<width>` selects a derived webp variant.
- The token's max age is `ATTACHMENT_TOKEN_MAX_AGE_SECONDS` (1h). **The serve route re-checks
  `deleted_at` and `uploaded` on every request** — a valid signature is not authorization to
  serve, which is what makes deletion effective against already-minted URLs.
- **Because the token expires, a signed URL must never be persisted.** Not in
  `conv_messages.attachments`, not in `body_html`, not in a cached payload. Mint one per request,
  in the request that serves it — `listForMessages()` and `hydrateProjection()` exist for exactly
  that. A URL written to the database is dead an hour later and renders as a broken image on
  every thread older than that.
- Token version is `av1`. Do not reuse `v1`: the email-open and attachment payloads are the
  same shape, so a shared version string lets one token verify as the other. There is a test
  for this (`attachment-token.test.ts`).

## Contract

`ConvAttachmentsService` (exported from `ConvModule`) is the only way in. Every method runs
inside the caller's tenant transaction via `getCurrentContext()`.

| Method | Use it for |
|---|---|
| `requestUpload({conversationId, name, mime, sizeBytes, sessionId?})` | Client-side upload (dashboard composer, widget). Returns an `AttachmentUploadHandle` with a presigned target; the row is `uploaded: false` until confirmed. |
| `completeUpload({id, sessionId?})` | Confirm a presigned upload. Verifies the object's real size against what was declared, derives variants. Pass `sessionId` from the widget so a session can only complete its own. |
| `persistBytes({conversationId, messageId?, name, mime, body, inline?, contentId?})` | Server-side ingest where we already hold the bytes: inbound email MIME parts, MMS media we fetched. One call, no presign. |
| `attachToMessage({messageId, conversationId, attachmentIds, sessionId?})` | Link uploaded rows to a message at send time. Validates ownership, conversation match, upload completion, and that the row is not already on another message. |
| `listForMessages(messageIds)` | Batch-load for DTO assembly. Returns `Map<messageId, AttachmentDto[]>`. |
| `projectForMessage(dtos)` | Shape for the denormalized `conv_messages.attachments` jsonb (see below). Carries no URL by design. |
| `hydrateProjection(orgId, projections)` | Read-time counterpart: takes rows out of the jsonb column and mints fresh `url` / `thumbnailUrl`. Use this when building a DTO. |
| `delete({id})` | Pre-send rows are hard-deleted; rows on a message are tombstoned. Idempotent. |
| `signUrl(orgId, id, variantWidth?)` | Mint a serve URL. Returns `null` when `MUNIN_KEY_PEPPER` is unset. |

## Limits — use the constants, don't re-declare them

`conv-attachments.constants.ts`:

- `CONV_ATTACHMENT_MIME_ALLOWLIST` — png, jpeg, gif, webp. SVG is rejected separately and
  explicitly (it can carry inline scripts). Adding PDFs or documents later is a change to this
  one array plus a dashboard preview fallback; nothing else should branch on mime.
- `CONV_ATTACHMENT_BYTES_MAX` — 10MB per attachment.
- `CONV_ATTACHMENT_PER_MESSAGE_MAX` — 10 attachments per message.
- `CONV_ATTACHMENT_PENDING_PER_SESSION_MAX` — 10 uncommitted uploads per widget session.
- `CONV_ATTACHMENT_INBOUND_BYTES_MIN` / `CONV_ATTACHMENT_INBOUND_EDGE_MIN_PX` — the floor the
  inbound-email filter uses to drop tracking pixels and signature logos. Unused until PR 2.

## `conv_messages.attachments` is a projection, not the source of truth

The column predates this work and is already read by `slack-projection.ts`
(`parseMessageAttachments`) and returned in `MessageDto`. Channel PRs write
`projectForMessage()` output into it so those readers keep working; `conv_attachments` rows stay
authoritative.

**The projection deliberately contains no URL** — only durable metadata (`id`, `name`, `mime`,
`sizeBytes`, `width`, `height`, `thumbnailWidth`, `inline`, `cid`, `deleted`). Anything reading
the column and handing it to a client runs it through `hydrateProjection()` first. A tombstoned
row projects with `deleted: true` and hydrates to `url: null`; every renderer must handle
`deleted` and show a placeholder rather than a broken image.

Inline email images are stored the same way: the HTML keeps its `cid:` reference and the
attachment row carries the matching `content_id`, so the `cid:` → URL mapping is also resolved at
read time. Nothing time-limited is written into `body_html`.

## Deletion is two-shaped

- `message_id IS NULL` (pending composer upload): hard delete, row and object both gone.
- On a message: **tombstone**. Objects are purged, `storage_key` is nulled and `variants`
  emptied, but `name`/`mime`/`size_bytes` survive with `deleted_at` + `deleted_by_*` for the
  audit trail. A message already emailed to a customer cannot be unsent, so the thread must keep
  recording that something was attached.
- Objects are purged **before** the DB write and a purge failure only logs. Bytes-present-but-
  marked-deleted is recoverable; marked-live-but-bytes-gone renders broken forever.
- `purgeObjects` deletes the master key **and every `variants[].storageKey`**. `cms.deleteAsset`
  does not do this and leaks its variant objects — do not copy that.

## Rules for the channel PRs

- **Pre-check, never `try/catch` a constraint.** A handler runs inside the request's outer tenant
  transaction, so a violation surfaces at commit, past any in-handler catch, as a bare 500. The
  service already guards conversation existence, mime, size, ownership, and per-message count.
- Errors carry `{message, code}` where a dashboard user can trigger them, so
  `translate-error.ts` can localize. Codes in use: `conv_attachment_invalid`,
  `conv_attachment_too_large`, `conv_attachment_too_many`, `conv_attachment_mime_rejected`,
  `conv_attachment_upload_missing`, `conv_attachment_size_mismatch`, `conv_attachment_conflict`,
  `conv_attachment_deleted`. Add an `errors.<code>` entry to **both** `messages/en.json` and
  `messages/nb.json` when you surface one in the UI.
- **Outbound email embeds real MIME parts, not URLs.** Read bytes with `storage.readBytes()` and
  attach them; do not put a signed URL in an email, where it would outlive its TTL in the
  recipient's mailbox and leak on forward.
- **Never trust a client-supplied `attachmentId`.** `attachToMessage` re-validates, but the
  widget path must also pass `sessionId` so one visitor cannot attach another's upload.
- Pending rows (`uploaded = false`, or `message_id IS NULL` past a grace period) are
  GC-eligible; `conv_attachments_pending_idx` exists for that sweeper. Nothing sweeps yet.

## Tests

`conv-attachments.integration.test.ts` (gated on `TEST_DATABASE_URL`) covers the presigned
round-trip, variant derivation, size-mismatch rejection, mime rejection, the per-session cap,
every `attachToMessage` refusal, both delete shapes, purge of master + variants, post-delete 404
on a previously valid URL, cross-tenant token replay, RLS isolation between orgs, and the
invariant that no signed URL reaches the persisted projection.

Extend it when you are working alone on this tree. When several PRs are in flight at once, put
channel-specific cases in a file under your own module directory instead — a shared test file is
the one guaranteed merge conflict between otherwise disjoint channel PRs.
