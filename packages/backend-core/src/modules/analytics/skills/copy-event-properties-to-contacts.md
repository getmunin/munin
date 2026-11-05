---
title: Copy event properties to contact fields
description: Copy a property your product sends with its events (a workspace name, a trial end date) onto the contact's custom fields, so journeys, segments and emails can use the latest value.
audiences: [admin]
---

# Copy event properties to contact fields

Product events sent to `POST /v1/events` keep their `properties` on the event itself. A journey can read the properties of the event that started it (`context.trigger.properties.<key>`), but nothing else can: a later email, a branch in another journey or a segment sees only the contact. When the product knows something about the person that the emails should say — what they named their workspace, when their trial ends — copy it onto the contact.

A mapping names a top-level event property and the contact custom field it goes to. Whenever an event that resolves to a contact carries a mapped property with a string, number or boolean value, Munin writes the value (trimmed, at most 500 characters) to that field:

- Empty strings, `null`, objects and arrays are skipped; the field keeps its value.
- An event never overwrites a value written from a newer event, so a retried or late batch cannot bring back an old name.
- Other custom fields are left alone.
- An event that resolves to no contact, and a repeated event id, copy nothing.
- Only events recorded after the mapping is saved are copied. Backfill earlier values with `crm_update_contact`.

## Procedure

1. `analytics_list_product_event_names` to see which events arrive. Ask the operator, or their developers, which property carries the value and on which events. If the product does not send it yet, they add it to the events that matter — typically the event that creates the thing and the one that renames it.
2. `analytics_get_product_event_fields` to read the current mappings. `analytics_configure_product_event_fields` replaces the whole list, so start from what is there.
3. Configure the mappings. Field names are snake_case; `events` limits a mapping to the named events and is left out to copy from any event that carries the property:

   ```json
   {
     "mappings": [
       { "property": "workspaceName", "field": "workspace_name" },
       { "property": "trialEndsAt", "field": "trial_ends_at", "events": ["trial.started", "trial.extended"] }
     ]
   }
   ```

4. Use the field. In a journey email write `{{contact.custom_fields.workspace_name|your workspace}}` (see `skill://journeys/build-journey`); a branch or a `wait.untilField` reads `contact.custom_fields.trial_ends_at`. After the next event arrives, `crm_get_contact` on that person shows the field.

Pass `{ "mappings": [] }` to stop copying. Values already written stay on the contacts.
