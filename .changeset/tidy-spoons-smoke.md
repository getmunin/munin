---
'@getmunin/backend-core': patch
'@getmunin/db': patch
---

Slack: move a CMS locale card into its article's thread when the parent arrives late

A translation group is a group of one until its second locale exists, and locales are written one `cms_create_entry` call at a time. So the bridge posted the first locale's card while `cmsGroupContext` still saw a single sibling, found no parent to thread under, and left it standing in the channel — the parent appeared underneath it seconds later and collected only the remaining locales. A four-locale article showed one stray headline plus a parent claiming four locales over three replies.

Slack has no API for moving a message into a thread, so the card is reposted under the parent and the original deleted. Whether a card is threaded is now stored (`slack_notification_links.slack_thread_ts`) rather than inferred: rehoming runs on every parent lookup and skips cards already in the thread, which makes it idempotent and safe to retry after a failed delivery. The backfill marks existing cards created after their parent — the ones that were threaded all along — so only genuinely stranded cards are moved.
