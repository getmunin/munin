---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
'@getmunin/docs-pages': minor
'@getmunin/types': minor
---

feat(conv): Reddit connects by authorization code instead of an account password

The Reddit channel authenticated with Reddit's **password grant**: the customer registered a "script" app and handed Munin their Reddit account password, which we stored pgcrypto-encrypted and replayed on every token refresh. That worked, and it cost two things worth more than the convenience.

**It excluded any account with 2FA.** Reddit's password grant wants the password and the current OTP joined as `password:otp`, which no unattended service can supply. So the setup skill had to instruct customers to turn 2FA *off* on the account that is the public voice of their brand. Asking someone to weaken the account we are about to speak through is the wrong trade, and no amount of documentation makes it right.

**And a stored password is full account access**, indefinitely, revocable only by changing the password — which breaks the integration and every other place that password is used.

Reddit is now connected with the **OAuth authorization-code flow**. A person clicks Connect, approves the permissions on reddit.com, and Munin stores a refresh token. 2FA works normally, because the authorization happens in their browser. The grant is scoped to `identity read submit privatemessages`, appears under the account's app permissions, and can be revoked from there without touching the password.

The client id and secret are unchanged and still required — they identify the API consumer, which under BYOK is the customer, which is what keeps Reddit's commercial-approval obligation theirs rather than Munin's. What goes away is the password.

### What changes for setup

The Reddit app is registered as a **web app** rather than a script app, and its redirect uri must be exactly `<your Munin URL>/v1/conversations/channels/reddit/oauth/callback` — Reddit compares it character for character, so a trailing slash or the wrong scheme is enough to be refused. Connecting is two steps: create the channel with the client id, secret and username, then authorize the account. The channel stays **inactive** until the authorization lands, so an unauthorized channel is never picked up by the poll worker or offered as a send target.

`conv_get_reddit_connect_url` returns the authorization link plus the redirect uri to register, and the dashboard offers Connect on an unauthorized channel and Reconnect on a connected one. Reconnecting is how a revoked grant is recovered.

Two refusals are deliberate and reported rather than papered over:

- **The authorization must come from the account the channel names.** Munin reads the authorized account back from Reddit and refuses a mismatch, because otherwise an operator signed into their personal account would silently have configured Munin to post as themselves.
- **All four scopes must be granted.** Reddit's consent screen lets a user untick permissions; a channel missing `submit` would accept a comment proposal and fail at send time, so it is refused at connect time instead.

### Two bugs this surfaced

**`completeSetup` activated a channel it had not authorized.** The credential link now delivers only the client secret, but `completeSetup` still set `active: true` unconditionally — a leftover from when that link delivered the last missing credential. The result was a channel the poll worker would tick and could not authenticate. It now gates on credential completeness, the way `createChannel` and `updateChannel` already did.

Worse, on the same path `toStored()` returns an empty refresh token, so re-running the credential link on an **already connected** channel silently wiped its authorization. `completeSetup` now preserves the stored token.

**The channel list shipped credential ciphertext to the browser.** `toChannelDto` returned `config: row.config` — the raw stored jsonb, including `encryptedClientSecret` and `encryptedRefreshToken`. Reddit configs now go through a redacting projection that surfaces `clientId`, `username`, `sendLimits` and a `connected` boolean and nothing else. The same leak exists for the other vendor-backed channels (twilio, messagebird, vapi, threll all store `encrypted*` fields the list still returns); that is pre-existing and left for its own change rather than fixed blind here, because those DTO shapes have consumers this PR does not touch.

### Breaking

`password` is gone from the Reddit channel config input, and `RedditChannelConfigDto` reports `connected: boolean` instead of a redacted `password`. Nothing to migrate: the password shape ships in the same release as this change, so no stored config ever held one.
