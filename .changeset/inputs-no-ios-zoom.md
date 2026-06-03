---
'@getmunin/ui': patch
'@getmunin/dashboard-pages': patch
---

Inputs and dashboard reply/edit textareas now render at `text-base` (16px) on mobile and `md:text-sm` (14px) from the `md` breakpoint up. iOS Safari auto-zooms on focus whenever the focused field's effective font-size is below 16px; bumping mobile sizes avoids that without disabling viewport zoom (which is a WCAG 1.4.4 regression). Desktop density is unchanged.
