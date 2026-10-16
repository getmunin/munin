---
"@getmunin/backend-core": patch
"@getmunin/dashboard-pages": patch
---

Imports and CMS entry writes now refuse ids that belong to another organization.

**Imports.** `conv_import`, `crm_import`, `outreach_import`, `analytics_import` and `cms_import`, plus their `/v1` transfer endpoints, used every id in a caller-supplied `idMap` as-is. A foreign key only proves the row exists, not that it belongs to the caller's organization, and row-level security checks the new row's own `org_id`, not the rows it references. That let an import attach records to another org's data: messages to its conversation, activities and deals to its contacts and pipelines, proposals to its contacts, analytics identities to its end users. The widget email-fallback worker then emailed such a planted message to the other org's customer.

Before writing, each import now does one batched lookup per reference kind. Every target that came from the caller's `idMap` and wasn't remapped by the import itself must exist in the caller's organization. Otherwise the whole import is refused with `<module>_import_invalid`, and the message names the offending idMap key. `kb_import` already resolved its parent space through a row-level-security-scoped lookup and is unchanged.

**CMS entries.** `cms_create_entry`, `cms_update_entry` (and the dashboard draft editor that uses it), `cms_restore_version` and `cms_import` used to accept any string in an `asset` or `reference` field, in an array of either, inside blocks, and in an inline `ref://` token. Now every asset or entry id a write introduces must exist in the caller's organization, checked with one batched lookup per write. Otherwise the write is refused with `cms_invalid_reference: field "<name>" points at <asset|entry> <id>, which does not exist in this organization`, with a matching `fieldErrors` entry. The dashboard shows a translated message for it (`errors.cms_invalid_reference`, en and nb).

- Ids already stored on the entry aren't re-checked, so an entry whose own reference was later deleted still saves.
- Inline `asset://` tokens keep their existing check.
- `cms_import` drops an `asset`/`reference` field value that is neither part of the import nor in the target organization, with a warning naming the entry, field and id. Before, the source id was stored and resolved to nothing. An unresolvable inline `ref://` token is left in place, with a warning.

No foreign data was exposed by planted CMS ids. Delivery, `cms_get_entry`/`cms_search_entries` expansion and asset-reference tracking already looked assets and entries up within the entry's own organization, so a foreign id resolved to `null`.

- Entry-reference tracking (`cms_references`) still recorded the cross-org link. It now records only references to entries in the same organization, as asset-reference tracking already did.
- This also fixes a 500 when saving an entry whose referenced entry had been deleted: the tracking insert used to hit the foreign key.

**Defense in depth:**

- The widget email-fallback worker only selects, quotes and counts messages whose `org_id` matches the conversation's.
- `loadPriorMessagesForQuote` now takes an `orgId`, so the email adapter's quoted history is filtered the same way.
- The outreach scheduled-send worker now sends each proposal in an RLS-scoped transaction for that proposal's organization, instead of with RLS bypassed. A proposal that references another org's contact can no longer be delivered.

**Audit log.** `analytics_import` marks a tracker's `identityVerificationSecret` input as sensitive, so a plaintext secret passed to it is redacted in the audit log. The import never stored it.
