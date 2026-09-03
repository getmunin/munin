---
'@getmunin/backend-core': patch
---

Document the widget's visitor-profile attributes in `skill://conv/setup-chat-widget`.

`data-munin-visitor-name`, `-email`, `-meta` and the `data-munin-meta-<key>` shorthand have been in the bundle and on the docs site, but not in the skill — so an agent provisioning a widget from `skill://conv/setup-chat-widget` alone had no way to know a name could be supplied, and shipped embeds that never sent one.

The gap has teeth because identity verification carries an `externalId` and nothing else. A verified visitor with no `data-munin-visitor-name` still gets an unnamed contact row, and every customer-facing surface falls back through name → email → phone — so the dashboard, the Slack mirror and outreach all end up showing a raw email address, or a generic placeholder when there is no email either. The new section says so, and §2's server-to-server "Visitor enrichment" now gives `visitor.name` the same treatment it already gave `visitor.email`.
