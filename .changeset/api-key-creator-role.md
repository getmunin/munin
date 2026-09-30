---
'@getmunin/backend-core': patch
'@getmunin/core': patch
---

An admin API key now acts with its creator's current org role instead of passing every role gate. A `*` key minted by an admin can do admin work but no longer gets through owner-only routes (removing members, revoking invitations). If the creator is demoted, the key loses those rights on its next request. Keys with no recorded creator, such as ones seeded straight into the database, are treated as admin and never as owner.

An admin key also stops working as soon as its creator stops being a member of the key's org. Removing a member revokes the admin keys they created in that org, so inviting them back doesn't bring old keys back to life. When account deletion is enabled, deleting an account revokes that user's admin keys in every org before the deployment's own `beforeDelete` hook runs. Widget and tracker keys are not affected.
