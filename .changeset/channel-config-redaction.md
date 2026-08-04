---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
---

fix(conv): the channel listing stops handing out credential material

`toChannelDto` surfaced `conv_channels.config` as stored, so both consumers of the channel list — `GET /v1/conversations/channels` (the dashboard) and `conv_list_channels` (MCP, admin audience) — returned every secret the jsonb holds: the pgcrypto ciphertext of the Twilio auth token, the MessageBird access + signing keys, the Vapi and Threll API keys and webhook secrets, the nested SMTP/IMAP passwords, and — in plaintext, since the widget never encrypted it — the chat widget's `identityVerificationSecret`.

Only the ciphertexts need `MUNIN_ENCRYPTION_KEY` to be worth anything, and that key is not in the payload; the widget secret needs nothing. What made all of it worth removing is that nothing on either side reads these fields, while an agent's copy of a tool result travels: into a transcript, a log line, or an LLM provider's request body. Credential-derived material crossing that boundary widens the blast radius of any unrelated leak, and it does so for no gain.

A single projection, `publicChannelConfig` (`conv/channels/public-config.ts`), now walks the stored config recursively before it is surfaced. An `encrypted<Field>` key becomes `<field>: '••••'` when a secret is stored and `<field>: ''` when it is not, which is the shape the per-vendor DTOs and the dashboard already expect — so the list and the configure responses finally agree, and "credentials present" stays readable without the ciphertext. The widget's `identityVerificationSecret` collapses to `hasIdentityVerificationSecret`, matching that module's own sanitizer. Being a rule about key shape rather than a per-vendor list, it covers a vendor added later.

`needsCredentials` was email-only and therefore wrong for all five vendor-backed kinds — a Twilio channel parked on an unopened credential link reported `false`. It now reads the `pendingSetup` marker too, so the flag is truthful for every channel.

That truthful flag needed somewhere to lead. The dashboard's only credential form was the email SMTP/IMAP one, so a pending Twilio or Vapi channel could be created by an agent and then only be finished by opening the one-time credential link — an odd detour for someone already signed in to the dashboard, and the reason a vendor channel's "Awaiting credentials" state had nowhere to go. Channels now renders the same generic form the connectors page already uses: the secret fields come from `GET /v1/conversations/channels/vendors` (`configFields` where `secret: true`), and saving posts to the existing `POST /v1/conversations/channels/:id/credentials`, which completes the vendor-side setup and activates the channel. No new endpoint, and the credential link keeps working for handing the job to someone who is not in the dashboard.

A pending channel row now reads like a pending connector card — the same `StatusLine` dot, an outline "Enter credentials" as the only action, and no Edit button or test/place-call entry in the ⋯ menu, since every one of those is rejected while the channel is awaiting credentials.
