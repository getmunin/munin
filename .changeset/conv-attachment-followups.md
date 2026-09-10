---
'@getmunin/backend-core': minor
---

Four follow-ups to conversation image support.

**A failed inbound store no longer loses the email.** The IMAP poll advanced its cursor past every
message it had fetched, whether or not the message was actually stored — so a transient storage or
database error during ingest silently dropped that email for good. The loop now distinguishes a
permanent failure from a transient one: an unparseable message is skipped and the cursor moves past it
(retrying forever would only stall the channel behind one bad email), while a failed *store* holds the
cursor at the last message that landed and stops the tick, so the next poll re-fetches and retries.
A held cursor also raises its own alert, keyed separately from the polling-failure alert so it does not
feed the auto-deactivation counter — mail is safe on the server, and deactivating the channel would
break outreach approvals for no reason.

**Legacy inlined images can be extracted.** `mailparser` was rewriting every inbound `cid:` image into
a base64 `data:` URI inside `conv_messages.body_html` (fixed separately by passing `keepCidLinks`), so
existing rows hold whole images inside a text column. `pnpm -F @getmunin/backend-core
backfill:inline-email-images` walks each org, promotes the qualifying images to real attachments, and
rewrites the HTML to a `cid:` reference matching the new `content_id`. It takes `--dry-run`, is
idempotent, and applies the same floor as inbound ingest, so tracking pixels stay inlined rather than
becoming attachments. On the smoke-test corpus one message went from 240,483 characters to 72.

**Deleting a CMS asset no longer leaks its variants.** `cms.deleteAsset` removed only the master
object, so every deleted image left up to five orphaned webp derivatives in storage forever. It now
deletes the keys named in `variants` as well.

**Abandoned uploads get collected.** `AttachmentGcWorker` deletes attachment rows that never made it
onto a message once they are past a grace period (default 60 minutes,
`MUNIN_ATTACHMENT_GC_GRACE_MINUTES`), purging the master and variant objects with them. It claims rows
with `FOR UPDATE SKIP LOCKED` so several instances can run it, and never touches a row that is already
on a message.
