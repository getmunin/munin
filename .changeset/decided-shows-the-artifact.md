---
'@getmunin/dashboard-pages': minor
---

Review → Decided now shows what was actually decided, read-only. The pane used to
carry a one-line decision record for everything but a published KB article; it now
renders the artifact itself: the social post with its media, link and first comment
(plus a permalink once it is live), the outreach message in its envelope, the
feedback text, the two CRM records with the keeper marked, and the CMS entry's
fields through the same viewer the queue pane uses in read mode.

The decision itself now leads the pane as one record card instead of two thin
prose blocks: the outcome sentence is set in serif with its consequence carried
in a cobalt italic, the reason sits under it with any `<module>_<code>` prefix
lifted into its own chip, and the decision's timestamp closes the card.
