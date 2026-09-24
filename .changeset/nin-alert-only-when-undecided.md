---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
---

National identity numbers now only raise a `data_protection` alert, and the owner email that goes with it, while the org has not chosen a redaction policy. Before, every org got a "Munin needs attention" email the first time a number arrived, even when redaction was already on and working, and the alert never closed. An org that deliberately keeps the numbers had no way to dismiss it.

Saving any policy, `off` included, now counts as the decision: it resolves the open alert, and later arrivals stay quiet whether they are redacted or kept. An alert left open from before this change resolves the next time a number arrives in an org that has a policy.

`conv_get_redaction_policy` and `GET /v1/conversations/redaction` return a new `configured` flag. The privacy settings page uses it to let an owner save the untouched default (`off`) as an explicit choice.
