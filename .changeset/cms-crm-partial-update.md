---
'@getmunin/backend-core': minor
---

`cms_update_entry` and `crm_update_contact` now do partial updates on their jsonb payloads. Previously you had to send every field on `cms_update_entry.data` (or every key on `crm_update_contact.patch.customFields`) even if you only wanted to change one — and for CMS the validator then re-ran against the full payload, so omitted required fields blew up the call.

Both tools now shallow-merge the incoming patch into the existing payload: keys you send replace the corresponding keys, keys you omit are preserved, and `key: null` clears a single key. CMS still re-validates the merged result against the collection schema, regenerates search_text + embedding, and rewires references.

No behavior change for callers that were already sending the full payload. The "wipe everything" case (set the whole bag to a new object) is rare in practice — if you need it, send the new payload plus explicit `null`s for the keys you want gone.
