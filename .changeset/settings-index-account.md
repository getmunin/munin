---
'@getmunin/dashboard-pages': patch
---

Open Settings on Account rather than Team.

`/dashboard/settings` redirected to Team, which is neither the first item in the rail nor the one most people want first. It now lands on Account, the top entry.

The target is derived from the first item of the first nav group rather than hardcoded, so it follows the rail if the order ever changes instead of quietly drifting out of step with it.
