---
'@getmunin/dashboard-pages': minor
---

Review → Decided now shows what was actually decided, read-only. The pane used to
carry a one-line decision record for everything but a published KB article; it now
renders the artifact itself: the social post with its media, link and first comment
(plus a permalink once it is live), the outreach message in its envelope, the
feedback text, the two CRM records with the keeper marked, and the CMS entry's
fields through the same viewer the queue pane uses in read mode.

The decision itself now leads the pane as one notice, built from the same
banner the queue panes already use for a warning — a 2px accent bar, a tinted
wash, a mono eyebrow and the sentence under it — in cobalt, or in the alert
palette when the send or publish failed. The outcome sentence carries its
consequence in an italic (every decidedSummary string now marks that clause
with <em>), a reason thrown by a service shows its `<module>_<code>` prefix as
its own mono token, and the decision's timestamp sits at the right edge.
