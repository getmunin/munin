---
'@getmunin/backend-core': minor
'@getmunin/inspector-app': minor
'@getmunin/dashboard-pages': minor
---

Outreach proposals say where they are going before you approve them

A proposal DTO now carries `delivery`: the campaign channel's type and vendor, the destination the approval would actually reach (email address for email campaigns, phone number for voice and SMS), and whether Munin will append the campaign CTA link and unsubscribe footer at send time. `contact` gains `phone` alongside `email`.

Both review surfaces use it. The MCP App panel and the dashboard drawer state the consequence in words — "Approving places a phone call to +1 415 555 9999", "Approving emails jane@acme.com. Munin appends the campaign CTA link, an unsubscribe footer" — and warn in red when the contact has no address or number on file, which is a send that would fail. A voice proposal's approve button reads "Approve & call" rather than "Approve & send", and its missing subject renders as "(spoken call — no subject)" instead of the bare "(no subject)" an email would show.

This matters most for voice campaigns, where approving dials a real phone number and the panel previously showed nothing but a subject-less body and an Approve button. It is worth having for email too: a reviewer approving a first-touch could not see the recipient address unless the contact happened to have no name.

The panel's `Proposal.kind` union was also missing `'followup'`, which every follow-up proposal has carried since sequences shipped.
