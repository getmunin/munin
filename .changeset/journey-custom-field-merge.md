---
'@getmunin/backend-core': minor
---

Journey messages can say what is on the contact. Email subject, preheader and body, and SMS and chat bodies, take `{{contact.custom_fields.<field>|fallback}}`, read when the message is sent, HTML-escaped in email, never merged into a link URL, and replaced by the fallback when the field is missing or blank. Email subjects and preheaders are now personalised too. `journeys_validate` warns about a custom field without a fallback (`merge_field_no_fallback`) and refuses one inside a link (`merge_field_in_link`) or a placeholder an email cannot fill (`unknown_merge_field`). `journeys_simulate` returns merged subjects, preheaders and SMS and chat bodies for each sample contact, and the new `journeys_send_test` sends one email step to a member of the organization, merged for a sample contact.

Product event properties can be copied onto contact custom fields: `analytics_configure_product_event_fields` maps a property (optionally only from named events) to a field, and every recorded event that resolves to a contact writes the value, without an older event overwriting a newer one. `analytics_get_product_event_fields` reads the mappings, and the new skill `skill://analytics/copy-event-properties-to-contacts` describes the setup.
