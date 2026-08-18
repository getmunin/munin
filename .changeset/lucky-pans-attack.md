---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
---

Reactivate an auto-deactivated email channel by fixing and saving it.

A channel that failed inbound polling five times is switched off and the card offered a filled Activate button inside the alert row, stacked above the outline Edit button in the footer — two competing action rows. The alert row is now diagnosis only (message plus the failure detail on its own line), and Activate sits next to Edit in the card footer.

The card also states its severity the way the awaiting-credentials card already did: `SettingsCard` takes an `accent` of `'pending'` or `'error'` instead of a `pending` boolean, so a deactivated channel gets a red top rule and a degrading one an amber rule. The redundant second status dot in front of the alert message is gone — the status line above it already carries the colour.

Norwegian copy for the polling alerts reads properly now: "Auto-deaktivert etter 5 feilede henteforsøk" became "Slått av etter 5 mislykkede forsøk på henting" — "feilede" is the wrong adjective form and "henteforsøk" is a constructed compound, and "Innkommende henting feiler" became "Henting feiler · 3/5 · slås av ved 5" on the card and "Henting av nye meldinger feiler på «…»" in the needs-attention banner.

Fixed alongside: a failed IMAP credential probe left an `ImapFlow` client with no `error` listener, so the socket timing out minutes later emitted an unhandled `error` event and killed the backend process. The probe now attaches a listener and closes the client in a `finally`, matching what the inbound poll adapter already did.

Saving an update to a channel that is currently deactivated now re-tests the stored credentials through the existing SMTP/IMAP probe: the channel is reactivated (and its alert resolved) when both connect, and otherwise stays deactivated with the connection errors returned in the response's `probe` field, which the edit dialog surfaces instead of silently flipping the channel back on with credentials that still fail. This applies to `conv_configure_email_channel` as well as the dashboard. The explicit Activate button remains for the case where nothing was wrong with the config — a mailbox that was down, a provider that throttled.
