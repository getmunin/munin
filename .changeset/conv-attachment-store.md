---
'@getmunin/core': minor
'@getmunin/db': minor
'@getmunin/backend-core': minor
---

Add the conversation attachment store that image support on email and the chat widget will be
built on.

Bytes live in the existing `AssetStorage` backend under a `conv/<orgId>/<conversationId>/` prefix
and are reachable only through short-lived HMAC-signed URLs (`GET /v1/c/a/:token`), never a
public key — conversation media is private per-conversation data, so it deliberately does not go
into `cms_assets` and never appears in the CMS library. The serve route re-checks the row on
every request, which is what lets a deletion invalidate URLs that were already handed out.

The attachment token uses its own `av1` version prefix. The email-open and attachment token
payloads are structurally identical, so sharing a version string would let a token minted for one
purpose verify as the other; there is now a test asserting they do not cross over.

Deletion is deliberately two-shaped. A not-yet-sent upload is hard-deleted, while an attachment on
a message that has already gone out is tombstoned: the objects are purged (master *and* every
derived variant, which `cms.deleteAsset` neglects for its own assets), but name, mime and size
survive with `deleted_at` for the audit trail. A message already delivered to a customer cannot be
unsent, so the stored thread has to keep recording that something was attached.

`assetExtensionFromName`, SVG rejection and the storage-key generator move out of `cms.service.ts`
into `common/storage/asset-validation.ts` so both modules share one definition.
