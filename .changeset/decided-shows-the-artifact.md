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
palette when the send or publish failed. A decision that carries a reason turns
the whole notice into a disclosure: an arrow sits under the timestamp at the
right edge, the tint lifts on hover, and clicking anywhere on the notice opens
the labelled reason underneath, with any `<module>_<code>` prefix a service
threw shown as its own mono token.
