---
'@getmunin/core': minor
---

Add the deterministic detectors and the substitution engine behind MCP pseudonymization. `detectPii` finds national IDs, emails, phone numbers, IBANs and Norwegian account numbers (checksum-validated) and card numbers (Luhn-validated). `pseudonymizeValue` walks any JSON value and replaces them, together with every name in the org's lexicon: people the org already knows become a stable token, everyone else becomes a generic mask such as `[NAME]`. `resolvePseudonyms` turns tokens in tool input back into real values.
