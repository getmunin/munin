---
'@getmunin/core': minor
---

Add national-ID detectors for Norwegian fødselsnummer, Swedish personnummer and Danish CPR.

Pure detection and redaction helpers, no callers yet. Each detector reports a confidence level rather than a bare boolean, because the three identifiers are not equally verifiable: Norway has two mod-11 check digits over a date, Sweden has one Luhn digit, and Denmark abandoned its modulus-11 check in 2007 when the per-day number pool ran out — so a bare Danish ten-digit run is date-shaped and nothing more. Callers pick a floor with `minConfidence`; the default of `high` keeps the separator-less Swedish and Danish forms out.

Precision is the whole point, so the detectors are built around what they must *not* match: Norwegian kontonummer share the second check digit's mod-11 weights, and Swedish organisationsnummer are ten Luhn digits. Requiring both Norwegian check digits, a parseable date, and at most one separator excludes the first; requiring a real month excludes the second.

Removal markers are written in the language of the identifier's own country, not the reader's locale — the body they land in is quoted back to the customer on reply, and it is one stable string for agents and exports either way.
