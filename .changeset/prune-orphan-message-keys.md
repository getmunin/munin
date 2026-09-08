---
'@getmunin/dashboard-pages': patch
---

Drop 50 message keys that nothing reads, in both locales.

Audited every leaf in `messages/en.json` against every `useTranslations`/`getTranslations` call in this repo **and** in the cloud web app that merges over this tree, keeping anything reachable through a computed key — `t(\`${state}Title\`)` on the verify-email page, `t(\`moduleDescriptions.${module}.readWrite\`)`on the consent screen,`t(\`kind_${change.kind}\`)`, `t(\`saved_${policy}\`)`, `t(\`channel_${kind}\`)`, `t(\`${vendor}.${field}.placeholder\`)`, and the whole `errors.*`namespace, which is looked up by API error code. 1775 leaves down to 1725, en and nb still in exact parity, and no`t()` call in either repo resolves to a key that no longer exists.

The console rework cleaned up after itself almost completely: of the 138 keys used by the six components it deleted, 122 went with them and the other 16 are still live elsewhere. It left exactly two behind. `nav.closeMenu` was kept on purpose — its changeset says "kept, since `dashboard-pages` is shared with the cloud web app" — but the cloud app never referenced it either, so the reason it was spared does not hold. `dashboard.apiKeys.copyClipboard` went unused when `KeyReveal`'s `copyLabel` prop went away, unremarked.

The other 48 are older debris that no release has swept since: the May 2026 usage redesign (`percentUsed`, `perMinute`, `perDay`, `resetNow`, `resetMinutes`, `resetHours`), the i18n consolidation of the same month (most of `dashboard.team.*`, `dashboard.agents.*`, `dashboard.auditLog.filter*`), the August channels and trackers card-grid redesign (`imapPolling`, `smtpServer`), the App Store integrations page (`integrations.slack.notConfigured`, superseded by `notConfiguredShort`), and a dozen keys — the vendor `*Chip` strings, `dashboard.trackers.rotated`, `agentSetup.apiKey.ledeStored` — that were written into the catalogue and never wired to anything at all.
