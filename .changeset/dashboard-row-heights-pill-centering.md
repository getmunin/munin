---
'@getmunin/dashboard-pages': patch
'@getmunin/ui': patch
---

Fix dashboard overview row heights and pill text centering. Queue rows no longer grow taller on hover — the right-hand slot now always reserves the action buttons' height (`h-7`) whether it shows the timestamp or the hover-revealed approve/dismiss buttons. The "open conversations" rows now reserve the same height, so both sections line up at a consistent row height. Pills (e.g. the `CMS` badge) get `leading-none` so their uppercase text is vertically centered within the badge instead of floating high.
