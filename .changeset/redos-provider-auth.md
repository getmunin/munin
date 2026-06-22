---
"@getmunin/agent-host": patch
---

Fix a polynomial-time ReDoS in provider credential validation: the trailing-slash trim on the user-supplied provider base URL used a backtracking regex (`/\/+$/`) on attacker-controllable input. Replace it with a linear scan.
