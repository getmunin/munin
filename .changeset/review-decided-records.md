---
'@getmunin/backend-core': minor
'@getmunin/types': minor
'@getmunin/db': minor
---

Record every review-queue decision durably, so the console's Decided tab can show more than KB curation.

`cms_entries` gains `archived_at` and `dismiss_reason`: archiving previously recorded nothing but `updated_at`, which a later edit overwrites, so an archived entry could not be placed in time. The column is cleared again whenever an entry leaves the archived state.

`feedback_outbox` gains `status`, `dismiss_reason`, `decided_by_actor_type`, `decided_by_actor_id` and `decided_at`, and the row is no longer deleted on dismissal or on a successful forward. `listPending()` now filters on `status = 'pending'` — before this, the delete was the only thing stopping an approved item from being forwarded twice. Feedback also emits `feedback.item.approved` and `feedback.item.dismissed`, the first events the module has ever published.

The CMS and feedback dismiss routes accept an optional `reason`; KB's already did.

Migration `0097_review_decided_records` backfills `archived_at` from `updated_at` for entries archived before the upgrade.
