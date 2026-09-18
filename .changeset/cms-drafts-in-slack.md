---
'@getmunin/backend-core': minor
---

Give CMS drafts an approval card in Slack.

A draft entry raises a card in the approvals channel with *Publish* and *Dismiss*, alongside the CRM, outreach, KB and social ones. It carries the title, collection, locale, slug and word count — deliberately not the body. An entry is blocks, assets and locales; quoting a flattened version of it in Slack would misrepresent what you are approving, so the card says what the decision is about and the dashboard shows what you are publishing. The button is bound to the entry version it rendered, so an edited draft is refused with a version conflict.

CMS publishing was previously announce-only: the entry went live and Slack said so, with no way to make the decision from there.

One structural change this needed. `cms.entry.published` is now both a decision (resolve the card in the approvals channel) and news (announce in the content channel), and the sink could only classify an event as one or the other. It now enqueues one delivery per subject, and the worker dispatches on the delivery's subject type rather than the event type — so both happen, in their own channels, from one event. Re-publishing an already-live entry raises no approval delivery, matching the rule that already governs the announcement.

The announcement is suppressed when it would land in the same channel as the card it duplicates; the resolved card carries the live article link instead. With a `content` channel routed, both still post — the card resolves for the people who decided, the announcement reaches everyone else. A publish that never had a card (created straight to published, promoted by the scheduled-publish worker, or published outright by an agent) announces as it always did, which is why dropping the announcement entirely was not the right call.

The locales of one article thread under a parent listing the locales still pending, mirroring how the publish announcement already groups a translation group — one thread per article instead of four side-by-side headlines. An entry with no translations posts standalone. The three parent kinds (outreach campaign, social set, CMS translation group) now go through one ensure/refresh pair keyed on subject type rather than a chain of per-type branches at four call sites.
