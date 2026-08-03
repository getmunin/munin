---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
'@getmunin/docs-pages': minor
'@getmunin/types': minor
'@getmunin/db': minor
---

feat(conv,outreach): Reddit channel with agent-driven thread engagement

A BYOK Reddit channel (`chat:reddit`), plus the outreach machinery for the org's own agent to run the loop: probe Reddit with live-read tools → qualify against the campaign brief and the subreddit's rules → propose either a DM to the OP or a public comment in the thread → a human approves → Munin posts, ingests replies, and the normal conversation loop takes over. Munin does no prospecting; `skill://playbooks/reddit-engagement` carries the judgment, the service carries the invariants.

Out of scope, deliberately: Reddit Chat (no public API — DMs land in the legacy "Messages" inbox, so a successful send is not delivered-to-attention), sequence follow-ups on threads (comment-bumping is ban-bait), and delivery/read receipts (they don't exist).

### Handle-based identity

`conv_contacts.handle` and `crm_contacts.handle`, org-indexed, alongside email and phone. A Reddit username is the whole address, so it is a column rather than `metadata` jsonb — no dedupe path, no index, and no CRM surface otherwise. Threaded through `crm_create_contact` / `crm_update_contact` / `crm_lookup_contact` / `crm_search_contacts`, export/import, and `MERGE_PATCH_ALLOWED_FIELDS` (a merge would otherwise silently drop it). Stored bare, without the `u/` prefix. Deliberately **not** on `crm_update_my_contact`: an end user must not be able to claim an arbitrary platform handle on their own record.

`ChannelIngestService` resolves email → phone → handle, and namespaces the `end_users.externalId` it mints as `<vendor>:<handle>`, so the same username on two platforms stays two people.

### Conversation keys — one conversation per thread, many authors

Conversations were keyed on *who wrote it* (org, channel, contact). That is right for email, SMS and DMs and wrong for a forum thread, where many people talk in one place. `InboundBatch` messages may now carry a `conversationKey`; ingest resolves on `(org, channel, metadata->>'conversationKey')` — unique index `conv_conversations_conversation_key_uq`, reopened if closed — and a keyed message **never** falls back to contact-threading, so a redditor's DM and their reply in a thread stay separate. `conv_messages.authorId` is already per-message, so each replier gets their own handle-based contact inside the shared thread conversation.

### Delivery outcomes: terminal and defer-until

`OutboundDeliveryWorker` knew one kind of failure: retry 5× with 30s × 2ⁿ backoff, then `dead`. Both halves are wrong for Reddit, where a rejected send usually means the account is in trouble and hammering it makes things worse. Adapters can now throw `ChannelSendTerminalError` (dead on the first attempt — recipient blocked us, thread locked, account suspended) or `ChannelSendDeferredError(message, nextAttemptAt)` (re-queued for that moment **without consuming an attempt** — a 429 can no longer exhaust the retry budget). Anything else keeps the old behaviour. Reddit reports several of these as HTTP 200 with a `{ json: { errors: [...] } }` body, so status alone is not the signal.

Steady-state pacing needed nothing new: the existing per-channel `sendLimits` sliding window already covers it, and the Reddit channel ships conservative defaults rather than adding a second limiter.

### Deliverability is per adapter, not per channel type

`ConvService` gated outbound delivery on a hardcoded `DELIVERABLE_CHANNEL_TYPES = ['email','sms']`, which cannot express "`chat:reddit` is queued but `chat:munin` is not" — the widget's `send()` is a no-op stub because the browser polls, so queueing for it would fire bogus `conversation.message.delivered` webhooks. `ChannelAdapter` now declares `outboundDelivery: 'queued' | 'none'` and the registry answers the question.

### Engagement campaigns

`outreach_campaigns.kind` is `'segment'` (every campaign that exists today, backfilled as DDL) or `'engagement'`. `segment_id` becomes nullable — an engagement campaign targets public threads, not a CRM audience — with a service pre-check plus CHECK `outreach_campaigns_segment_required_ck` as the backstop, in both directions: a segment campaign without a segment is invalid, and so is an engagement campaign with one. `kind` cannot be patched; moving a campaign between kinds would orphan its proposals.

`outreach_proposals` gains the `'thread_comment'` kind, a nullable `contact_id`, and a `target` jsonb (`{ threadId, permalink, subreddit, title, opHandle }`). CHECK `outreach_proposals_one_target_ck` enforces exactly one of the two, so a proposal can never carry a thread the service branch will silently ignore.

**Thread comments skip consent and suppression entirely.** A public post has no data subject to consent, so the contact-consent path does not apply and no CRM contact is touched. What governs them instead is subreddit cadence (`maxPerWeekPerSubreddit`, `maxCommentsPerDay`) and one comment per thread per campaign, enforced by `outreach_proposals_thread_comment_uq` spanning `pending|approved|sent`. That index is one index rather than one per status group on purpose: with separate pending and approved/sent indexes, a thread already commented in still accepts a new pending draft and the collision only fires when a human clicks approve — as a unique violation mid-request, which poisons the transaction and surfaces as a bare 500. It is scoped to `kind='thread_comment'`, so replies to whoever answered us are unconstrained, and cadence counting is scoped the same way: being responsive in a thread you already joined must not spend the cold-comment budget or a busy conversation would silence the campaign everywhere else.

Approving a thread comment opens a contactless conversation stamped with the campaign and the thread key, then sends through the normal path. Because Reddit comments are public, irreversible, and posted under someone else's moderation, they join voice and SMS in requiring a signed-in person to approve — an agent or API key cannot.

The email-only reply gate becomes `canSendNow(conversation, channel)`, which asks whether *this conversation* may be replied to rather than which channel types may reply. Existing refusals keep their message verbatim. Follow-ups stay email-only.

The consent/suppression predicate had been copy-pasted at four call sites with two different message texts; it is now one helper with both texts preserved, so no caller sees a changed error string. `approveReply`'s long-standing lack of a consent re-check is preserved rather than quietly fixed — changing it would block in-flight reply drafts, and it deserves its own decision.

### DMs

A Reddit first-touch is an ordinary contact-targeted proposal and takes the full consent path — the campaign is on a Reddit channel, the contact needs a `handle`, and that requirement is checked at propose time the way phone is checked for voice and SMS, rather than failing after a human has already approved the draft. `approveInitial` gained the matching branch: it resolves or creates a `conv_contacts` row keyed on the handle and opens the conversation, so `ProposalDelivery.destination` reports the username instead of the `null` that would make an agent report "no address on file".

The body never carries an unsubscribe **URL**. A tracking link in a cold DM is a spam signal, and Reddit is not email, so the composer appends a plain sentence inviting a reply instead — the same shape as the SMS composer's `Reply STOP to opt out.`, which is also not a link.

`POST /api/compose` returns no fullname for the created message, so a DM's `providerMessageId` is `null`. That is fine — DM threading is contact-based — but it means DMs cannot be correlated back to a Reddit object the way comments can (`/api/comment` does return `t1_…`).

### The Reddit token cache is keyed on the channel, not on a hash of the password

`RedditClientService` caches the OAuth bearer and the last observed rate-limit window per credential set. That key was a SHA-256 of `(clientId, clientSecret, username, password)`, which CodeQL flagged as `js/insufficient-password-hash` (high). The digest was never stored, logged or transmitted, but the finding pointed at something real: `clientId` and `username` are not secrets, so a leaked digest — one stray log line printing a map key would do it — reduces to brute-forcing the two secret fields, unsalted, at SHA-256 speed.

`RedditCredentials` now carries an opaque `cacheKey` that `loadCredentials(channelId, stored)` stamps with the channel id, and the cache uses it directly. No secret reaches a digest at all, so there is nothing to brute-force and no hash to argue about. A salted HMAC was tried first and rejected: it removes the offline-attack property but still trips the rule, and "is this hash strong enough" is the wrong question when the key never needed to be derived from secrets.

Keying on the channel is also what makes it tenant-safe. The tempting simplification — key on the non-secret `clientId` + `username` — would be a cross-tenant credential-confusion hole: one org could register a channel with another org's client id and username plus a wrong password, collide on the cache key, and be handed the other org's cached bearer token without ever proving the password. A channel id is unique, org-scoped, and 1:1 with a credential set, so two channels on the same Reddit account correctly get their own token rather than sharing one. There is a test for exactly that.

Rotation still self-heals: a token issued under old credentials fails with a 401, which already evicts the cache entry.

### A raw NUL byte made a source file invisible to grep

The separator between those joined fields was a **literal NUL byte** rather than an escape. The intent was right — an unambiguous separator so `("ab","c")` cannot collide with `("a","bc")` — but a raw NUL makes `file(1)` classify the source as binary, and `grep`/`ripgrep` then **silently skip the entire file**: searching it for any symbol returns no matches and no error. That masked several searches while investigating this alert, including one that made a function look uncalled when it had four callers.

Nothing caught it, because a raw NUL inside a TypeScript string literal is valid to the compiler, the linter and the tests. `src/source-text.test.ts` now fails on any NUL byte under `src/`.

### Vendor-backed channels can no longer be created with plaintext secrets

`conv_create_channel` accepted any `chat` vendor with a free-form `config`, because until now every `chat` channel was the self-contained widget. Reddit is `chat` *and* vendor-backed, so that route would have created a live Reddit channel with the client secret and account password sitting in `conv_channels.config` as plaintext — bypassing pgcrypto, the credential handoff, and the inactive-until-verified rule. `ConvService.createChannel` now refuses any vendor that has a registered `ChannelAdminProvider`, which closes it for Reddit and doubles as a backstop for the voice and SMS vendors that were previously excluded only by the type enum.

### Renamed: the channel-admin tools now name the boundary they actually have

Reddit registers as a `ChannelAdminProvider`, so the voice/SMS names became untrue — `conv_list_voice_sms_vendors` would list Reddit:

- `conv_list_voice_sms_vendors` → `conv_list_channel_vendors`
- `conv_configure_voice_sms_channel` → `conv_configure_vendor_channel`
- `conv_test_voice_sms_channel` → `conv_test_vendor_channel`
- `conv_send_sms_channel_test` → `conv_send_vendor_channel_test_message`

`conv_list_channel_options` was already generic and is unchanged.

This is the second rename of these four, and the previous one (`1461e0e`) went the other way — from unqualified names to `voice_sms` — for a good reason: these tools resolve vendors only in the `ChannelAdminProvider` registry, so `conv_test_channel` sounded universal while failing on an email channel with `unknown channel vendor 'smtp'`. That reasoning still holds; a plain `conv_test_channel` would re-introduce exactly that defect. But `voice_sms` no longer describes the set either, and `voice_sms_reddit` does not scale.

So the names now say what the set actually is: a **vendor-backed** channel is one provisioned through a vendor credential handoff. Today that is Vapi, Threll, Twilio, MessageBird and Reddit. Email and widget are not vendor-backed and keep their own tools (`conv_configure_email_channel`, `conv_create_widget_channel`, `conv_test_email_channel`, `conv_send_email_channel_test`), which the descriptions now state outright rather than leaving to be discovered by a failed call. It is the same concept the new `conv_create_channel` guard enforces, so the surface and the invariant use one vocabulary.

Breaking, with no aliases published: callers that hardcode the old names must update.

### New surface

- `conv_search_reddit_threads`, `conv_get_reddit_thread`, `conv_get_subreddit_rules` — read-only, admin, `conv:read`, each taking a `channelId` to pick BYOK credentials. Payloads are bounded and report their own truncation; a comment tree is unbounded and results over ~150k characters break MCP App rendering.
- `outreach_propose_thread_comment` — a separate tool from the contact-targeted propose tools, per the split-read-write convention.
- `skill://conv/setup-reddit-channel`, `skill://outreach/draft-thread-comment`, `skill://playbooks/reddit-engagement`.

Munin never appends an unsubscribe footer on Reddit: a tracking URL in a cold DM is a spam signal. The skills carry "reply to opt out" and `doNotContact` semantics instead.

BYOK means the customer registers their own **script** app at reddit.com/prefs/apps, logged in as the account that will be posting, and is the API consumer of record — so Reddit's commercial-use approval is their obligation, not Munin's. The account cannot have 2FA enabled: Reddit's password grant wants `password:otp`, which no unattended service can supply. Fresh and low-karma accounts get sends rejected outright and shadowbans are invisible over the API, which is why `sendLimits` defaults to 3/hour and 15/day and the setup skill leads with account warming rather than treating it as a footnote.

Migration `0061_reddit_channel_engagement` is idempotent throughout and was smoke-tested against a database already at `0060_outreach_scheduled_send` — seeded with pre-existing campaigns, a pending proposal and an approved/scheduled one — then verified as the non-superuser `munin_app` role, since a superuser connection bypasses RLS and hides the failure that matters.

It also picks up scheduled sends, which landed on main while this was open. `outreach_proposals_open_pair_uq` widened its predicate to `status IN ('pending','approved')` there, on the reasoning that an approved send waiting for its slot must block a fresh duplicate draft just as a pending one does. The contactless analogue added here follows it: `outreach_proposals_open_conv_uq` spans pending and approved for the same reason, rather than pending alone. The thread-comment index already spanned `pending|approved|sent`, so it needed no change.

The Reddit approve paths hang off main's new delivery split: `approveProposal` fingerprint-checks the draft and stamps approval, then either delivers now or parks the row for the send worker, and `deliverProposal` dispatches on kind. Thread comments and Reddit DMs are `deliverThreadComment` / `deliverInitialDirectMessage` under that dispatcher, so a scheduled Reddit send goes through the same worker as everything else. `approveProposal` now also refuses a kind with no delivery path **before** stamping approval, so an unroutable proposal stays pending instead of being marked approved and then failing to deliver.
