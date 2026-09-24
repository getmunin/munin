---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
---

National identity numbers now only raise a `data_protection` alert, and the owner email that goes with it, while the org has not chosen a redaction policy. Before, every org got a "Munin needs attention" email the first time a number arrived, even when redaction was already on and working, and the alert never closed. An org that deliberately keeps the numbers had no way to dismiss it.

Saving any policy, `off` included, now counts as the decision: it resolves the open alert, and later arrivals stay quiet whether they are redacted or kept. An alert left open from before this change resolves the next time a number arrives in an org that has a policy.

`conv_get_redaction_policy` and `GET /v1/conversations/redaction` return a new `configured` flag, which drives the reworked privacy settings page:

- What happens to a match is now a radio list (remove, keep the date of birth, store unchanged) with nothing preselected until the org has chosen. Save stays disabled until one is picked, so storing the numbers unchanged is a deliberate choice rather than an untouched default.
- An unconfigured org sees a note, marked with a yellow dot, explaining that owners are alerted until a choice is saved.
- The settings sidebar shows a yellow dot next to Privacy while a `data_protection` alert is open. Settings nav items can name an `alertSource` to get the same indicator.
- New `RadioRow` in the settings scaffold, alongside `CheckboxRow`.
