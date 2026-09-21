---
'@getmunin/dashboard-pages': minor
---

Review → Decided now shows what was actually decided, read-only. The pane used to
carry a one-line decision record for everything but a published KB article; it now
renders the artifact itself: the social post with its media, link and first comment
(plus a permalink once it is live), the outreach message in its envelope, the
feedback text, the two CRM records with the keeper marked, and the CMS entry's
fields through the same viewer the queue pane uses in read mode.

The decision itself now leads the pane as one record: a cobalt rule over a pale
cobalt ground with the outcome stated in plain sans — or the alert palette
throughout, the pane's own eyebrow included, when the send or publish failed.
The record carries no label of its own; the eyebrow above the title already
names the outcome, and a second one over a self-describing sentence was noise.
A reason sits on its own panel below, always under the same label; where the
service threw a `<module>_<code>:` prefix, that code is lifted out beside the
label as its own token and the message is set in mono. The decision's timestamp
closes the card.

A failed decision is visible before you open it: its row in the Decided list
carries a red dot and sets its outcome in the alert ink, so a send that gave
up does not read like an ordinary dismissal while scanning.
