---
'@getmunin/dashboard-pages': patch
---

The review panes had four ways of saying the same thing: a filled left-rule
notice with a mono eyebrow (outreach deliverability and revised-after-review,
the CMS preview blocked and failed states), a bare left-rule one-liner with no
fill (outreach's missing destination), and a pane-wide row that reached for the
`destructive` token rather than the alert family — two alerts in one console
that were not even the same red. They now share one `PaneNotice`: tone, an
optional eyebrow, an optional trailing action, and the fill following from
whether it has either, so the distinction between a headed notice and a lone
sentence is a prop instead of five copies of the same class list. The action
banner keeps its own shape — it is a pane-level report of a failed click, not
an inline caveat — but wears `alert-bad-ink` like everything else.
