---
'@getmunin/dashboard-pages': minor
---

Rebuild Account, AI and Privacy on one settings scaffold.

Every settings page now shares a measure and a section grammar: a 720px column, a 420px field (a field's width should predict its content length), a serif section heading with mono meta right-aligned over a full-ink rule, hairline rows instead of nested cards, and one Save per section at its end.

Disabled Saves are a hairline outline rather than a grey fill — a grey fill reads as a live secondary button.

The confidence selector only appears when a detector that has loose forms is enabled — Swedish personnummer or Danish CPR. For a Norway-only setup every match carries two check digits, so the control had nothing to decide.

The AI page loses its three job lists, leaving Persona / Provider / Models; its lede no longer promises the jobs. Privacy moves below Trackers in the settings rail. The now-unreachable job-list components and their message keys go with them.
