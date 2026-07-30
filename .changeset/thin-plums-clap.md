---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
'@getmunin/types': patch
---

SMS channel dialogs: agent-reply select on create, sender switching actually clears

The "Agent replies" select is now on the SMS create dialog, not just edit — a new channel no longer silently starts on `auto` until someone goes back and changes it. Renamed from "Default agent mode" / "Inbound replies" to a shared "Agent replies" across email and SMS dialogs, since "agent mode" is the database column name, not something an operator configuring a phone number has a mental model for.

Twilio's From-number and Messaging-Service-SID fields are now a single "Send from" choice instead of two always-visible inputs with an "either, both is also OK" caveat. Switching the choice on an existing channel now actually clears the field you switched away from — `updateChannel` previously merged with `?? prev`, so the old value survived a switch and both were sent on every message.
