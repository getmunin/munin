---
'@getmunin/backend-core': patch
'@getmunin/db': patch
---

Stop reading an Outlook reply's sender off the block it quotes.

`FORWARD_MARKERS` counts a rule of ten or more underscores as a forward marker. Outlook and Exchange print exactly that rule above the header block they quote — on replies as much as on forwards — so `resolveForwardOrigin` scanned the lines below it, found the quoted `Fra:`, and filed the address the customer was *answering* as the address they wrote from. The real sender, which is the envelope `From` and was never in doubt, was demoted to `metadata.forwarding.forwardedBy`.

Where an organisation sends campaign or transactional mail from the same address its support channel receives on, every Outlook reply therefore collapsed onto one contact: the organisation's own support address. Unrelated customers shared a single identity and a single history, `crm_get_my_contact` answered with the organisation rather than the person, and an approved draft would have been addressed back at the mailbox it arrived from.

A manual forward is now distinguished from a quoted reply by two facts already present in the block being parsed. If the quoted `To:` or `Cc:` names the envelope sender, that sender was the original *recipient* — they replied, they did not forward — and the header block is quoted history, not a forward. And a forward origin is never allowed to resolve to an address the channel itself owns: neither its `addressing.fromAddress` nor its inbound relay address. Genuine forwards are unaffected, including the divider-only block Outlook writes when an operator forwards a customer's mail on.

Recipient labels are read with the same localised vocabulary the quoted-thread parser already carried, now shared between the two rather than duplicated, so the `To:` check holds in every language the `From:` detection that triggers the block does.

A migration repairs the messages already misattributed this way. The sender is recovered from `forwardedBy`, the conversation, its messages and its identity are re-pointed at that person — reusing their existing contact where one exists rather than minting a second — and a display name is lifted from the quoted recipient line when one sits there, left null otherwise, since a wrong name reaches the customer in a greeting while a missing one only shows the address. The organisation's own address is then dropped as a contact once nothing points at it. Ids are derived from org and address so a re-run converges rather than duplicating.
