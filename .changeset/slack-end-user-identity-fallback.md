---
'@getmunin/backend-core': patch
---

Slack now names a customer from their end-user identity when the contact row is bare.

The Slack bridge resolved a customer's display name from `conv_contacts` alone — name, then email, then phone — and fell back to the literal "Customer" when all three were null. Every other read of a conversation goes through `ConvService.getConversation`, which falls back to the linked `end_users` row (`contactEmail: row.contactEmail ?? row.endUserEmail`). Two chains, one conversation, different answers.

That gap is reachable on the widget's normal identity path. A visitor who chats anonymously first gets a contact row with no name or email; when they later verify, `findOrCreateContact` and `claimAnonymousIdentityInTx` stamp `endUserId` and `metadata.externalId` onto that row but never backfill `email` or `name`. The identity carries the address, the contact does not — so the dashboard showed the customer's email while Slack showed "Customer", with nothing misconfigured on either side.

`loadConversation` now loads the linked end user and merges the two the same way the conversation DTO does, so the thread parent's `*From:*` line, the per-message speaker name and the Slack avatar initial all agree with the dashboard. "Customer" is once again reserved for a genuinely unidentified visitor.
