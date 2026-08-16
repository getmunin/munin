---
'@getmunin/backend-core': patch
---

Treat anonymous and phone-derived identities as provisional when resolving `identify`

`identify` refused to adopt an `end_users` row whose `external_id` was an `anon:<session>` key, because only `email:` prefixes and `NULL` counted as provisional. Those anon keys are throwaway widget-session ids, not real identities — and the chat widget stamps the visitor's email onto them through visitor enrichment, so they routinely hold an address.

The result: a visitor who chatted with the widget and later signed in hit the conflict branch instead of the adoption branch. `identify` created a second row with no email, logged `identify.email_conflict`, and did so on every subsequent call — the web journey could never join the email identity, which is the exact split this feature exists to close. `phone:` keys had the same gap.

Both prefixes are now provisional alongside `email:`, so the anonymous row is promoted in place to the caller's real external id: the row id never changes, everything already attached to it stays attached, and the throwaway key is retired as a side effect. Existing rows heal on the next identify; no migration required.

Note that migration `0069`'s keeper ordering shares the blind spot — it ranks `anon:` as a real id when choosing which duplicate survives — so a deploy that merged duplicates may have kept an anon-keyed row. That is cosmetic rather than harmful: the merge itself repointed every reference correctly, and the first identify after this fix promotes the key.
