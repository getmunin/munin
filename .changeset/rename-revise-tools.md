---
'@getmunin/backend-core': minor
---

Rename the two `revise` tools to `update`, and say in the KB and CMS update tools that a
queued candidate or draft is editable through them.

Two tools out of 224 used `revise` where the rest of the surface uses `update`:
`social_revise_post_draft` is now **`social_update_post_draft`**, and
`outreach_revise_proposal` is now **`outreach_update_proposal`**. If the rule had been
"proposals get revised, records get updated" the odd verb would have earned its place, but
the other two proposal kinds are edited with `kb_update_document` and `cms_update_entry` —
so `revise` predicted nothing, and an agent looking for how to change a queued item had to
guess between two verbs. Both titles follow ("Social: Update post draft", "Outreach: Update
proposal"). No behaviour changes: same inputs, same service methods, same scopes.

This breaks any agent that calls the old names, and there is no alias — the point of the
rename is one verb, not two.

The reason the verb mattered is the second half of this change. `kb_update_document` and
`cms_update_entry` are how you edit a curation candidate or a CMS draft while it is still
waiting in the review queue — a candidate *is* a document row and a draft *is* an entry,
which is why `/v1/kb/curation/candidates/:id` and `/v1/cms/drafts/:id` both PATCH through
those very service methods. Neither description said so, so an agent asked to fix a typo in
a queued proposal had to infer that a candidate id is a document id. Both now name the case
and point at the tool that lists the ids.
