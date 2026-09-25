---
'@getmunin/core': minor
---

Add stable pseudonym tokens and the per-org identity lexicon behind MCP pseudonymization. `buildPiiLexicon` merges CRM contacts, conversation contacts and end users that share an email or phone into one identity, and gives it a token keyed on the org, the identity and a deployment secret, so the same person carries the same token across every module and a token cannot be recomputed from a guessed email. `findPseudonymReferences` finds rendered tokens in text so tools can accept them back as input.
