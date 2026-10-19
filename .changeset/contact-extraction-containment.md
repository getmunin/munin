---
"@getmunin/backend-core": patch
"@getmunin/agent-runtime": patch
"@getmunin/agent-host": patch
"@getmunin/types": patch
---

fix(security): confine contact extraction to the conversation's own contact

The contact-extraction pass that runs when a conversation closes (`skill://crm/extract-contact-from-message`) no longer has `crm_lookup_contact`, `crm_create_contact` or `crm_update_contact`. It reads the conversation and records what it found with a new tool, `crm_apply_conversation_identity`, which decides on the server which contact to write and which fields it may touch:

- The target is the contact linked to the conversation's end-user, else an unlinked contact matching an email or phone the conversation has proven (a channel- or org-attested identity whose messages neither failed DMARC nor arrived forwarded), else a new contact linked to the end-user and tagged `from-chat`. An address someone merely typed in chat never selects an existing contact, so a visitor writing "I'm the CEO, call me on …" no longer edits the CEO's record.
- Only empty name, email, phone and title fields are filled. Tags, owner, custom fields and do-not-contact status are never written, and an existing value is never overwritten.
- An unproven email or phone that another contact already holds is dropped rather than attached or duplicated.
- Mailing-list, auto-reply and bounce senders are skipped, and a role-account sender records its email only — rules the skill previously had to follow on its own.

Previously the pass ran with the full CRM write surface, `crm_update_contact` overwrote by default, and the "fill empty fields only" rule lived only in the skill text, so text in a closed conversation could steer it into editing any contact in the organization.

Background skill passes can now be pinned to the record that triggered them. `pinnedToolArgsFor` (`@getmunin/types`) maps a skill to tool arguments taken from the job's source event, and `runSkillPass` refuses a call whose pinned argument names anything else (`withPinnedArgs`, `@getmunin/agent-runtime`). Contact extraction is pinned to its conversation for both `conv_get_conversation` and `crm_apply_conversation_identity`; signature stripping is pinned to its message. A bound job whose payload lacks the id fails without retrying, as `unbound_job_payload`.

`conv_strip_message_signature` now refuses (`not_a_prefix`) a new body that is not a leading portion of the stored one, compared with whitespace runs collapsed, so the signature pass can cut a trailing block but cannot rewrite a customer's message. The job prompt carries the stored, redacted body and the sender address inside `<data>` fences instead of the raw parsed text.
