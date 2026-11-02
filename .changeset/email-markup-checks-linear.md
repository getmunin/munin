---
'@getmunin/backend-core': patch
---

Email content and template checks run in linear time. The patterns that spot document tags, disallowed elements and `javascript:` links no longer backtrack on long runs of whitespace after `<` or `=`, which made a 50,000-character body take seconds to validate. The journey simulator's tallies also store counts only as own properties, so an edge or exit named `__proto__`, `constructor` or `prototype` counts correctly instead of reaching the object's prototype.
