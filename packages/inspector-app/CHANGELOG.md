# @getmunin/inspector-app

## 5.12.0

### Patch Changes

- Updated dependencies [1836666]
  - @getmunin/dashboard-pages@5.12.0
  - @getmunin/types@5.12.0
  - @getmunin/ui@5.12.0

## 5.11.0

### Patch Changes

- Updated dependencies [9d09f89]
- Updated dependencies [e055fa3]
- Updated dependencies [2169915]
- Updated dependencies [0106285]
- Updated dependencies [bec14d1]
- Updated dependencies [c8ed388]
- Updated dependencies [9991922]
  - @getmunin/dashboard-pages@5.11.0
  - @getmunin/ui@5.11.0
  - @getmunin/types@5.11.0

## 5.10.0

### Minor Changes

- 3136f2b: A curation candidate can now propose a new version of a document that already exists, instead of only a new document beside it.

  `kb_propose_curation_revision` files a proposed body against an existing `documentId`; `kb_publish_curation_revision` applies it as a new version of that document, so `kb_list_versions` and `kb_restore_version` roll a bad revision back. It takes two versions — the candidate text that was reviewed and the document text it was diffed against — and refuses if either moved, writing nothing. `kb_publish_curation_candidate` refuses a revision candidate rather than quietly publishing a duplicate.

  This is what a corrected fact should produce. A human editing an agent draft usually contradicts a document the draft was built from, and the old flow could only file a new FAQ beside the stale one, leaving the wrong text in place for the agent to retrieve again.

  Revisions share one review queue with new-document candidates: `kb_list_curation_candidates` carries `revisesDocumentId` plus the revised document's current title and version, and each surface branches per row — the dashboard drawer and the MCP Apps panel render a diff against the current text (new `BodyDiff`, backed by a dependency-free line differ in `@getmunin/types`), the control plane gains `POST /v1/kb/curation/candidates/:id/publish-revision`, and Slack shows the card without a publish button, since its approval value carries only one version. The panel's "loading" state for a candidate body was also unreachable — it reported a load failure while the fetch was still in flight.

  Curation decisions are now keyed by conversation **and** source message (`kb_curation_decisions.source_message_id`). One conversation can legitimately surface several corrections across turns; the old conversation-wide key closed it to curation after the first. Decisions recorded before this keep the whole-conversation lock, so nothing already dismissed reopens. Related: `kb_propose_curation_candidate` accepted `sourceMessageIds` and silently dropped it — the first entry is now persisted.

  `skill://kb/review-content` delta mode now prefers a revision over a new document and says how much to change; `kb_get_document`, `kb_list_curation_decisions` and `kb_propose_curation_revision` are added to the skill's runner allow-list. The skill's step 0 has always required `kb_list_curation_decisions`, which the runner could not call, so "skip already-decided sources" silently never ran.

### Patch Changes

- Updated dependencies [3136f2b]
- Updated dependencies [3136f2b]
- Updated dependencies [3136f2b]
- Updated dependencies [2e95f5e]
- Updated dependencies [b8690cb]
  - @getmunin/dashboard-pages@5.10.0
  - @getmunin/types@5.10.0
  - @getmunin/ui@5.10.0

## 5.9.0

### Patch Changes

- Updated dependencies [2e00517]
  - @getmunin/dashboard-pages@5.9.0
  - @getmunin/types@5.9.0
  - @getmunin/ui@5.9.0

## 5.8.0

### Patch Changes

- Updated dependencies [2c7e3fd]
  - @getmunin/dashboard-pages@5.8.0
  - @getmunin/types@5.8.0
  - @getmunin/ui@5.8.0

## 5.7.0

### Patch Changes

- Updated dependencies [5818e0e]
- Updated dependencies [233842d]
  - @getmunin/dashboard-pages@5.7.0
  - @getmunin/types@5.7.0
  - @getmunin/ui@5.7.0

## 5.6.0

### Patch Changes

- @getmunin/types@5.6.0
- @getmunin/ui@5.6.0
- @getmunin/dashboard-pages@5.6.0

## 5.5.0

### Patch Changes

- Updated dependencies [4f8a169]
  - @getmunin/dashboard-pages@5.5.0
  - @getmunin/types@5.5.0
  - @getmunin/ui@5.5.0

## 5.4.0

### Patch Changes

- @getmunin/types@5.4.0
- @getmunin/ui@5.4.0
- @getmunin/dashboard-pages@5.4.0

## 5.3.0

### Patch Changes

- Updated dependencies [55dc284]
  - @getmunin/dashboard-pages@5.3.0
  - @getmunin/types@5.3.0
  - @getmunin/ui@5.3.0

## 5.2.2

### Patch Changes

- Updated dependencies [8fd15f9]
- Updated dependencies [5ea99ce]
  - @getmunin/dashboard-pages@5.2.2
  - @getmunin/types@5.2.2
  - @getmunin/ui@5.2.2

## 5.2.1

### Patch Changes

- Updated dependencies [f646c5d]
  - @getmunin/dashboard-pages@5.2.1
  - @getmunin/types@5.2.1
  - @getmunin/ui@5.2.1

## 5.2.0

### Patch Changes

- @getmunin/types@5.2.0
- @getmunin/ui@5.2.0
- @getmunin/dashboard-pages@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [be67821]
- Updated dependencies [be67821]
  - @getmunin/types@5.1.0
  - @getmunin/dashboard-pages@5.1.0
  - @getmunin/ui@5.1.0

## 5.0.2

### Patch Changes

- @getmunin/types@5.0.2
- @getmunin/ui@5.0.2
- @getmunin/dashboard-pages@5.0.2

## 5.0.1

### Patch Changes

- @getmunin/types@5.0.1
- @getmunin/ui@5.0.1
- @getmunin/dashboard-pages@5.0.1

## 5.0.0

### Patch Changes

- Updated dependencies [ace185f]
  - @getmunin/types@5.0.0
  - @getmunin/dashboard-pages@5.0.0
  - @getmunin/ui@5.0.0

## 4.81.0

### Patch Changes

- Updated dependencies [39777ed]
  - @getmunin/dashboard-pages@4.81.0
  - @getmunin/types@4.81.0
  - @getmunin/ui@4.81.0

## 4.80.1

### Patch Changes

- @getmunin/types@4.80.1
- @getmunin/ui@4.80.1
- @getmunin/dashboard-pages@4.80.1

## 4.80.0

### Patch Changes

- Updated dependencies [12d99b9]
- Updated dependencies [556e620]
- Updated dependencies [cf10e8c]
- Updated dependencies [2d896ca]
- Updated dependencies [3695371]
  - @getmunin/dashboard-pages@4.80.0
  - @getmunin/types@4.80.0
  - @getmunin/ui@4.80.0

## 4.79.0

### Patch Changes

- Updated dependencies [dfd3327]
  - @getmunin/dashboard-pages@4.79.0
  - @getmunin/types@4.79.0
  - @getmunin/ui@4.79.0

## 4.78.0

### Minor Changes

- 5802b45: Outreach: `proposedSendAt` now actually schedules a send

  A proposal's `proposedSendAt` used to be inert metadata — it was stored, revisable and exported, but approval always delivered immediately and no worker ever read the column. Approving a draft that said "send Tuesday 09:00" sent it on the spot.

  Approval is now the authorization, and the send time is honored:

  - `outreach_approve_proposal` takes an optional `sendAt`. With no argument it inherits the draft's `proposedSendAt` when that is still in the future; `sendAt: null` forces an immediate send; a `sendAt` in the past is refused. A scheduled proposal parks at `status: 'approved'` with `scheduledSendAt` set, and `outreach_list_proposals({ status: 'approved' })` lists what is waiting, soonest first.
  - A new `OutreachSendWorker` drains due proposals (default every 60s, `MUNIN_OUTREACH_SEND_POLL_MS`, disabled by `MUNIN_OUTREACH_SEND_WORKER_DISABLED`) and re-runs every eligibility check at send time: campaign still enabled, contact not suppressed and still consented, and no prospect reply on a follow-up. A proposal that fails any of them goes to `status: 'failed'` with `failureReason` instead of being delivered. Quiet hours and blackout dates hold the send until the window opens rather than failing it. Transient delivery errors retry up to five attempts (`send_attempts`) before giving up.
  - New `outreach_cancel_scheduled_send` pulls an approved send back to `pending` before it goes out — the one real undo in outreach, and only before delivery.
  - New events: `outreach.proposal.scheduled`, `outreach.proposal.send_canceled`, `outreach.proposal.send_failed`.
  - The dashboard drawer names the inherited time on its approve button and offers Send now / Schedule…; a Scheduled sends section lists what is queued with a call-off action. The Inspector panel labels the button **Approve & schedule** and spells out the time above it.

  The one-proposal-per-(campaign, contact, kind) unique index now covers `approved` alongside `pending`, so a contact with a scheduled send cannot pick up a second in-flight draft. Proposals that were scheduled on a source server import as `pending` with a warning — no timer follows the data across servers.

### Patch Changes

- 5b4fb1a: Bind merge application to the proposal that was reviewed.

  `crm_apply_merge_proposal` took only `{ id }`, and `crm_propose_merge` does not always create a proposal: on a pair that already has a pending one it updates that row in place, overwriting `confidence`, `evidence`, `recommendedKeeperId` and `recommendedPatch` under the same id. Merge proposals also have none of the review tracking outreach has — no `revisionCount`, no `revisedAfterReviewAt` — so the rewrite was completely silent. A curator pass that re-filed a pair with the keeper flipped would change the card an operator was reading, and their click would retire the contact they meant to keep.

  Applying is not a small write: it copies the patch onto the keeper, repoints activities, deals and relationships, archives the duplicate with `doNotContact: true` and a cleared `endUserId`, auto-dismisses pending outreach proposals for the duplicate, and auto-dismisses other pending merge proposals touching it. Unwinding all of that by hand is not realistic, and the dismissed outreach followups do not come back.

  Proposals now carry a `mergeFingerprint` over `(contactAId, contactBId, recommendedKeeperId, confidence, recommendedPatch)` and apply requires it — `{ id, fingerprint }` on the MCP tool, `{ fingerprint }` in the body of `POST /v1/crm/merge-proposals/:id/apply`. A mismatch is a `409` with `crm_conflict`: nothing is merged and the proposal stays pending. The Slack apply button carries the digest in its action value; the panel and the dashboard pass what they rendered, and the panel re-lists on a refusal so the operator lands on the current proposal with the conflict still shown.

  The digest deliberately covers the proposal row and not the contact rows behind it. `crm_update_contact` can change the name or email a card displays, but it cannot change which record survives or what patch lands, and digesting live contact fields would invalidate queued cards on ordinary CRM activity — conflicts on untampered work teach operators to click through them.

  `evidence` is also excluded, so the weekly hygiene pass can refresh its reasoning on a pending pair without invalidating a queue the operator is working through. Only a changed decision invalidates a review.

- 992f78a: Make a dismissed KB curation candidate stay dismissed.

  Candidates are `kb_documents` rows that are deleted on dismiss and on publish, and the only thing stopping a curation pass from refiling a source conversation was a candidate still sitting in `kb-curation-inbox`. Empty the inbox — review a batch, publish two, dismiss the rest — and the next weekly sweep redrafts the same conversations from scratch. That happened in production: candidates reviewed on 26 July came back on 2 August, six weeks after the conversations themselves.

  `kb_curation_decisions` records one row per decision (`dismissed` or `published`) with the reason, the deciding actor, and the published document when there is one. Rows outlive the candidate and the source conversation. `kb_propose_curation_candidate` now pre-checks the source conversation and throws `kb_curation_decided` when one exists, so the gate is enforced in the service rather than described in the skill — the "last 7 days" and "resolved handovers only" rules were prose-only, and the sweep that produced those drafts honored neither.

  Blocking is coarse and permanent, matching `crm_merge_proposals`: one decision retires the whole conversation, and there is no un-dismiss. Title matching would lose to rewording — the June and August drafts of the same answer had different titles. Something genuinely new from a decided conversation goes in with `kb_create_document`.

  New tools: `kb_dismiss_curation_candidate` (deletes the draft, records the decision, takes an optional `reason` and the reviewed `ifVersion`) and `kb_list_curation_decisions` (filter by `outcome` or `sourceConversationId`). Dismissing with `kb_delete_document` still records a reasonless decision, so the Slack button, the dashboard drawer and the Inspector panel are all covered by the same choke point in `removeDocument`.

  `POST /v1/kb/curation/candidates/:id/dismiss` accepts `reason` and `ifVersion`; `KbCurationDecidedError` maps to a 409 there. The dashboard drawer and the panel now say the dismissal is permanent.

- f5b2992: Bind KB curation publishing to the version that was reviewed.

  A curation candidate is an ordinary KB document, `kb_update_document` rewrites its title and body, and `publishCurationCandidate` copies `candidate.title` and `candidate.body` verbatim into the target space. So an agent could rewrite the draft after the review card rendered and the operator's click would publish text nobody read.

  `kb_publish_curation_candidate` now requires `ifVersion`, the same optimistic-concurrency argument `kb_update_document`, `kb_delete_document` and `kb_restore_version` already take, and `POST /v1/kb/curation/candidates/:id/publish` takes it in the body. A mismatch throws `KbConflictError`, nothing is written to the target space and the candidate stays in the inbox. The check runs before target-space resolution, so a refused publish no longer auto-creates a space as a side effect.

  `KbConflictError` now maps to a 409 in the candidates controller. It was unmapped, so a version conflict on that route surfaced as a bare 500.

  The Slack publish button carries the reviewed version in its action value, which the approval codec already had a slot for. Without it the Slack path would have read the current version and passed that back, making the check vacuously true on the one surface where the card can sit unread the longest.

  Also fixes the Inspector panel's Dismiss button, which called `kb_delete_document` without the required `ifVersion` and therefore failed schema validation on every click. Both panel actions now use the version of the body the operator actually opened, falling back to the list version. Publish re-lists on a refusal so the operator lands on the current draft with the conflict still shown.

- d78ff2a: Bind outreach approval to the draft that was reviewed, not to the proposal id.

  `outreach_approve_proposal` took only `{ id }`, so it meant "send proposal #a3f9", never "send the email I just read". `outreach_revise_proposal` is model-callable and mutates a pending draft in place, so an agent could rewrite the body after the panel, the dashboard drawer or the Slack card had rendered it — and the operator's click would send the rewrite. The revision count on the card was the only tell, and it was advisory: a human had to notice it on a card they had already decided about.

  Every proposal now carries a `draftFingerprint` (a digest of campaign, contact, kind, subject, body and proposed send time) and approval requires it — `{ id, fingerprint }` on the MCP tool, `{ fingerprint }` in the body of `POST /v1/outreach/proposals/:id/approve`. A mismatch is a `409` with `outreach_conflict`: nothing is sent and the proposal stays pending, so the drift goes back through review instead of through the wire. Approve already re-checked campaign state, contact suppression and superseding replies at click time; the draft text is now one of those conditions.

  All three review surfaces pass what they rendered. The Slack approve button carries the digest in its action value, and the bridge already re-renders the card on `outreach.proposal.updated`, so a revised draft rebinds its button and a card that missed the update refuses rather than sending stale text. The Inspector panel re-lists on a refused approval so the operator lands on the current draft with the conflict still shown.

  This deliberately stops short of single-use tokens. The proposal state machine already refuses anything non-pending, which covers replay; what was missing was binding the decision to the content, and a digest does that without an issuance store or a secret inside the iframe. `crm_apply_merge_proposal` and `kb_publish_curation_candidate` are still id-bound and want the same treatment.

- Updated dependencies [f3db6e6]
- Updated dependencies [5b4fb1a]
- Updated dependencies [992f78a]
- Updated dependencies [f5b2992]
- Updated dependencies [d78ff2a]
- Updated dependencies [5802b45]
- Updated dependencies [180727a]
  - @getmunin/dashboard-pages@4.78.0
  - @getmunin/types@4.78.0
  - @getmunin/ui@4.78.0

## 4.77.0

### Minor Changes

- 2d14917: fix(outreach): keep `outreach_list_proposals` payloads bounded

  `outreach_list_proposals` returned every column of every matching row, curator `evidence` included. Evidence is an unbounded JSONB the curator fills with sources, compliance notes and reasoning — around 4,000 characters per proposal in practice, roughly three quarters of a row. Combined with a default limit of 100 and a default of all statuses, a queue of ~16 proposals already produced an 80,000-character result that clients refuse, and 100 rows would have been half a million characters. The failure is silent-ish and total: the MCP Apps panel renders the size error instead of the review UI, and the model gets no data either, so the review pass just stops.

  List rows now carry the draft, the nested `contact` / `campaign` / `delivery` summaries and a boolean `hasEvidence`, but not `evidence` itself. The default limit drops from 100 to 25 and the ceiling from 500 to 200.

  The new `outreach_get_proposal` reads one proposal by id with the full evidence attached, so nothing became unreachable — this exposes the `getProposal` service method the Slack bridge and `GET /v1/outreach/proposals/:id` already used. The Inspector panel's **Evidence** toggle now fetches on click rather than receiving evidence for every card up front.

  `GET /v1/outreach/proposals` and the inbox queue return the same trimmed rows. Nothing in the dashboard rendered `evidence` from a list response.

### Patch Changes

- Updated dependencies [2d14917]
- Updated dependencies [cfa7b4f]
- Updated dependencies [2808e5d]
  - @getmunin/dashboard-pages@4.77.0
  - @getmunin/types@4.77.0
  - @getmunin/ui@4.77.0

## 4.76.0

### Minor Changes

- 1461e0e: Rename MCP tools so a tool's name says which surface it acts on, and add a test that keeps names and titles in agreement

  The channel tools were the worst offenders: `conv_test_channel` and `conv_send_channel_test` sounded universal but only resolve vendors in the voice/SMS adapter registry, so calling either on an email channel failed with `unknown channel vendor 'smtp'`. Meanwhile `conv_create_channel` sounded universal but only handles email and chat. The unqualified names were the narrow ones, and three verbs (`create` / `setup` / `configure`) meant the same action across three channel families. Renames:

  - `conv_setup_email_channel` → `conv_configure_email_channel`
  - `conv_send_email_test` → `conv_send_email_channel_test`
  - `conv_widget_create_channel` → `conv_create_widget_channel`
  - `conv_widget_update_channel` → `conv_update_widget_channel`
  - `conv_widget_rotate_key` → `conv_rotate_widget_key`
  - `conv_widget_rotate_identity_secret` → `conv_rotate_widget_identity_secret`
  - `conv_configure_channel` → `conv_configure_voice_sms_channel`
  - `conv_test_channel` → `conv_test_voice_sms_channel`
  - `conv_send_channel_test` → `conv_send_voice_sms_channel_test`
  - `conv_list_channel_vendors` → `conv_list_voice_sms_vendors`

  `conv_create_channel` now rejects `voice` and `sms` at the schema instead of asking the model not to pass them. Taking that path used to insert a row with `active: true`, no adapter binding and no credential link — a channel that looked configured and could not send. `conv_import` still accepts all four types, since importing historical conversations is not the same as provisioning transport.

  Elsewhere the same operation carried different verbs, and four singular/plural pairs were distinguished by one letter where the rest of the surface uses `get_X` / `list_Xs`:

  - `crm_find_contact` → `crm_lookup_contact` (matches the connector modules' `lookup` for keyed-by-email reads)
  - `bookings_lookup_bookings` → `bookings_list_guest_bookings`
  - `bookings_get_my_bookings` → `bookings_list_my_bookings`
  - `commerce_lookup_orders` → `commerce_list_customer_orders`
  - `commerce_get_my_orders` → `commerce_list_my_orders`
  - `crm_change_stage` → `crm_change_deal_stage`
  - `cms_search` → `cms_search_entries`
  - `slack_test` → `slack_send_test_message`
  - `kb_import_website_status` → `kb_get_website_import_status`
  - `outreach_propose_initial` → `outreach_propose_initial_message`
  - `analytics_get_traffic_by_source` → `analytics_list_traffic_sources`
  - `feedback_get` → `feedback_get_item`, `feedback_create` → `feedback_create_item`, `feedback_list` → `feedback_list_pending_items`, `feedback_search` → `feedback_search_roadmap`, `feedback_vote` → `feedback_vote_on_roadmap_item`

  The `feedback_*` prefix covered two unrelated corpora with nothing in the names to say so: `feedback_list` reads the local outbox awaiting admin action, while `feedback_search` queries the public Munin roadmap.

  Descriptions that no longer matched behaviour are corrected. `outreach_propose_initial_message` and `outreach_approve_proposal` still described email-only sends after SMS and voice campaigns shipped; approving now documents an email, an SMS, or an outbound call, and `outreach_propose_followup` states that sequences are email-only. `conv_list_channels` claimed `voice` and `sms` were "reserved for upcoming adapters" — both have shipped. `conv_request_channel_credentials` is generically named and generically implemented but claimed to be email-only, so an agent holding a pending Twilio channel would have skipped the one tool that mints its credential link.

  Titles now restate their tool's name rather than drifting from it — they are what a host shows in a permission prompt. Analytics titles were noun phrases ("Top referrer hosts") where the rest of the surface is imperative, and the bookings titles said "Book a table" for a vendor-agnostic bookings contract that also serves non-restaurant venues.

  `tool-naming.test.ts` boots the registry and asserts, across every registered tool, that names carry a known module prefix, that titles start with that module's display prefix, that a title's leading word matches the verb in its name, that a title mentions the object its name acts on, and that no two tools share a title. It caught three tools this pass that the manual review missed: `conv_widget_rotate_key` and `conv_widget_rotate_identity_secret` kept the family-before-verb shape, `conv_request_callback` was titled "Place a phone call…" against a name that promises a request, and `analytics_export_config` was titled "Export trackers + visitor identities" — accurate about the payload, silent about the `config` its name promises.

### Patch Changes

- Updated dependencies [1461e0e]
  - @getmunin/dashboard-pages@4.76.0
  - @getmunin/types@4.76.0
  - @getmunin/ui@4.76.0

## 4.75.0

### Minor Changes

- cc87bb6: Outreach proposals say where they are going before you approve them

  A proposal DTO now carries `delivery`: the campaign channel's type and vendor, the destination the approval would actually reach (email address for email campaigns, phone number for voice and SMS), and whether Munin will append the campaign CTA link and unsubscribe footer at send time. `contact` gains `phone` alongside `email`.

  Both review surfaces use it. The MCP App panel and the dashboard drawer state the consequence in words — "Approving places a phone call to +1 415 555 9999", "Approving emails jane@acme.com. Munin appends the campaign CTA link, an unsubscribe footer" — and warn in red when the contact has no address or number on file, which is a send that would fail. A voice proposal's approve button reads "Approve & call" rather than "Approve & send", and its missing subject renders as "(spoken call — no subject)" instead of the bare "(no subject)" an email would show.

  This matters most for voice campaigns, where approving dials a real phone number and the panel previously showed nothing but a subject-less body and an Approve button. It is worth having for email too: a reviewer approving a first-touch could not see the recipient address unless the contact happened to have no name.

  The panel's `Proposal.kind` union was also missing `'followup'`, which every follow-up proposal has carried since sequences shipped.

- b98f618: Outbound calls and text messages are approved only by a person in the dashboard

  A proposal whose campaign runs on a voice or SMS channel can now only be approved by a signed-in dashboard user. `outreach_approve_proposal` refuses every other caller — an MCP agent, an unrestricted admin API key on the control plane, a curator, the Slack approval button — and the proposal stays `pending`. Email approval is unchanged, including by agents and admin keys.

  The check lives in `OutreachService.approveProposal`, so it holds regardless of which surface the call arrives through. It is not an MCP tool-visibility hint: hosts that don't implement MCP Apps still list the tool, and calling it on a voice proposal fails there too.

  Slack declines these in-thread with a pointer to the dashboard rather than surfacing a service error. The Inspector panel drops the approve button for voice and SMS proposals — Dismiss stays, since dismissing sends nothing — and says where the call is actually placed.

  Quiet hours and blackout dates are now enforced when a call or text is approved. They were previously stored on the campaign and consulted only when listing due follow-ups, so nothing stopped a call at 3am. `cadenceRules` gains an optional `quietHoursTimezone` (IANA, validated) that quiet hours and blackout dates are read in; without it they are read in UTC, which is not what a Norwegian campaign means by "no calls before 08:00".

### Patch Changes

- Updated dependencies [8e98f2d]
- Updated dependencies [cc87bb6]
- Updated dependencies [b98f618]
- Updated dependencies [862b055]
- Updated dependencies [c5a05c5]
- Updated dependencies [c5a05c5]
  - @getmunin/dashboard-pages@4.75.0
  - @getmunin/types@4.75.0
  - @getmunin/ui@4.75.0

## 4.74.0

### Patch Changes

- c7bf800: CMS: the `cms_list_assets` panel shows two rows and opens an asset in a dialog.

  The panel rendered every asset the tool returned — an org with 60 images got 60 thumbnails, and picking one appended a detail block below the fold, so the thing you clicked and the thing you wanted to read were never on screen together.

  - **Eight thumbnails, then a footer control.** The grid is pinned to four columns (two on narrow hosts) and cut at two rows. The footer carries the state and the action: `8 OF 16 ASSETS` alongside `SHOW ALL 16 ↓`, toggling back to `SHOW FEWER ↑`. Nothing is dropped silently — the count is always the full total, and the toggle only appears when there is something hidden.
  - **Clicking a thumbnail opens a modal over the grid**, not a block under it: scrim, viewport-centered card, image scaled to fit, then the name, mime and size, alt text, the public URL with a copy-to-clipboard button, and the usage line from `cms_list_asset_usage` (still fetched once per asset and cached). Escape, the ✕ and a scrim click all close it. Copy degrades quietly where the host iframe withholds clipboard access.
  - **The backdrop matches the shared dialog** (`packages/ui` `DialogBackdrop`): `ink/40`, no blur, no drop shadow. The design mock called for a blurred scrim and a 60px shadow, but nothing else in the system does that — none of the 21 UI components carry a shadow at all.

- Updated dependencies [cad7227]
- Updated dependencies [c7bf800]
  - @getmunin/types@4.74.0
  - @getmunin/dashboard-pages@4.74.0
  - @getmunin/ui@4.74.0

## 4.73.0

### Minor Changes

- 62776e2: CMS: `cms_get_entry` no longer renders an MCP Apps panel.

  An entry is a document — long prose, blocks, images, under a user-defined schema — which is the worst fit for a fixed card in a chat transcript. The panel rendered every field stacked at full height and dumped `blocks` fields as raw JSON into a `<pre>` with no height cap, so reading one article produced a screen-and-a-half of transcript.

  The decisive constraint is that the binding is per-tool, not per-call: hosts resolve `_meta.ui.resourceUri` from the tool definition, and neither the MCP Apps spec nor the ext-apps SDK defines a way to suppress rendering for a single call. So a panel that is mildly useful when reviewing one draft is unavoidably also rendered five times when an agent reads five entries for a research pass. There is no setting that makes it appear only when it helps.

  Nothing moves out of reach. `cms_publish_entry` / `cms_unpublish_entry` / `cms_schedule_publish` were never app-only — unlike the outreach and CRM proposal actions — and they carry `destructiveHint: true`, so the human confirmation lives in the host's destructive-tool prompt rather than in a panel button. The tool result is unchanged: the full entry JSON was always in `content`, which is what the model reads.

  The inspector app keeps its other six panel-bound tools (`cms_list_assets`, `kb_list_curation_candidates`, `crm_list_merge_proposals`, `outreach_list_proposals`, and the four analytics reads), all of which wrap bounded, actionable payloads. The entry view, its type guards, its `inspector.entry` translations, and its styles are deleted.

### Patch Changes

- 0ac33df: Commerce: a product search renders as a gallery instead of a wall of prose.

  `commerce_search_products` returns image, title, price range and a storefront link per product, and until now every one of those had to survive a round trip through the model's prose. This adds a rendered surface for that result on all three chat surfaces, over one payload contract.

  - **New `MessageComponent` contract** (`@getmunin/types`): a Zod-validated `product_list` payload with a `source` block naming the connection that produced it, capped at 8 items. Price formatting lives in a deliberately dependency-free `@getmunin/types/message-format` subpath so the browser bundles can import it without dragging zod along — `formatPriceRange` renders `priceMin`/`priceMax` through `Intl.NumberFormat` from the payload's own `currency`, collapsing an equal min/max to a single price and falling back to `<amount> <code>` when a vendor reports a currency `Intl` doesn't know.
  - **The payload is derived server-side from the typed tool result, never authored by the model.** `runAgent` already returns each turn's tool calls with their raw results, so the conversation handler maps the last successful `commerce_search_products` call of the turn into components and persists them on `conv_messages.metadata`. The model cannot invent a price, a stock claim or a spec line, because there is no field for one. A refined second search supersedes the first; an errored search falls back to an earlier successful one; a search with no matches attaches nothing.
  - **Insecure or malformed URLs are nulled rather than dropping the product**, so a vendor serving images over http yields a card with a placeholder instead of a missing product. The schema itself requires https, and non-JSON or unparseable results are ignored entirely.
  - **Widget exposure is a whitelist, not a spread.** `conv_messages.metadata` also carries runner state (session ids, provider message ids, claim holders), so the widget's message list reads only the `components` key and re-validates it against the schema on the way out. Components are only ever attached to, or rendered on, `agent`/`user` messages, and never on internal notes.
  - **Chat widget** renders the gallery natively: an edge-to-edge scroll-snap rail that bleeds into the panel's own padding so the next card is visibly cut, a placeholder for missing or blocked imagery, and the connection named in a provenance line. It costs **1 kB gzip**. Hosting the real MCP App panel here was measured and rejected: `AppBridge` alone is 33.5 kB gzip and the panel it renders is 324 kB gzip — roughly twice the entire widget — on a customer's own marketing page, and an anonymous visitor has no MCP session for the panel to call tools against.
  - **Agent inbox** renders the same payload with the same rules, below the bubble at full drawer width rather than inside the 85%-max bubble. Native rather than an `AppBridge` host because the inbox is a transcript: a conversation with five product searches would mean five 324 kB iframes, each fed a persisted snapshot into a panel built around a live `ontoolresult`.
  - **claude.ai and other MCP App hosts** get the gallery via a new `views/products.tsx` in the inspector panel, shape-routing on the `{ connection, products }` tool result the way the six existing views do, with `commerce_search_products` now declaring `_meta.ui.resourceUri`. The panel keeps its own shape guard rather than importing the schema, matching how every other view there works. An empty result falls through to the neutral view.
  - `cdn.shopify.com` joins the panel's CSP `resourceDomains` so Shopify imagery actually loads. Other vendors host product images on the merchant's own domain, which is per-connection and cannot be known when the resource is built — those cards show the placeholder. Making that allowlist org-aware is follow-up work.
  - The `skill://commerce/answer-product-questions` skill now tells the agent what the gallery already shows, so prose stops restating prices and links, stops promising a count it hasn't verified, and names missing specs (weights, materials) as absent from the product feed rather than inferring them.

  No migration: `conv_messages.metadata` is existing jsonb.

- Updated dependencies [62776e2]
- Updated dependencies [0ac33df]
- Updated dependencies [09a2eeb]
  - @getmunin/dashboard-pages@4.73.0
  - @getmunin/types@4.73.0
  - @getmunin/ui@4.73.0

## 4.72.0

### Minor Changes

- c81065d: Serve MCP protocol revision 2026-07-28 alongside 2025-11-25

  `/mcp` now speaks both protocol eras from the same endpoint. Modern clients get the
  stateless 2026-07-28 revision (no `initialize` handshake, no `Mcp-Session-Id`,
  `server/discover`, per-request `_meta` envelope, `Mcp-Method`/`Mcp-Name` header
  validation); existing 2025-era clients keep working unchanged.

  - Migrated from `@modelcontextprotocol/sdk` v1 to the v2 package split
    (`@modelcontextprotocol/{server,client,node}`). `createMcpServer` now returns a v2
    `Server`, and the HTTP entry is `createMcpHandler` + `toNodeHandler` instead of
    `StreamableHTTPServerTransport`. **Breaking for anyone embedding
    `@getmunin/mcp-toolkit` directly.**
  - `tools/list`, `resources/list` and `resources/read` advertise `ttlMs` /
    `cacheScope` on the 2026 revision, scoped `private` because listings are filtered
    per actor audience and scopes.
  - `tools/list` is now returned in a stable, name-sorted order so clients can cache it.
  - POSTs to `/mcp` whose `Content-Type` media type is not `application/json` are
    rejected with `415 Unsupported Media Type` (SDK v2 parses the header instead of
    substring-matching it). MCP SDK clients always send `application/json`; parameters
    like `charset=utf-8` continue to work.
  - The authorization server advertises
    `authorization_response_iss_parameter_supported` (RFC 9207 / SEP-2468), which
    BetterAuth already emits, and derives its BetterAuth `baseUrl` from
    `authorizationServerUrl()` so the advertised issuer and the emitted `iss` cannot
    drift apart.

### Patch Changes

- Updated dependencies [f7113e4]
- Updated dependencies [064cd7b]
- Updated dependencies [a567576]
  - @getmunin/dashboard-pages@4.72.0
  - @getmunin/ui@4.72.0

## 4.71.0

### Patch Changes

- @getmunin/dashboard-pages@4.71.0
- @getmunin/ui@4.71.0

## 4.70.1

### Patch Changes

- @getmunin/ui@4.70.1
- @getmunin/dashboard-pages@4.70.1

## 4.70.0

### Minor Changes

- 4601314: Extend the inspector MCP App with five new views: CRM merge-proposal review (side-by-side contact comparison with app-only apply/dismiss), KB curation-candidate review (new `kb_list_curation_candidates` tool, app-only `kb_publish_curation_candidate`), analytics charts (views over time, funnel, traffic by source, contact journey), CMS entry preview with publish/unpublish/schedule actions, and a media-library thumbnail gallery. The panel resource now CSP-allows the asset-storage origin so thumbnails render inside the iframe.
- e123820: Add `outreach_revise_proposal` and `outreach_withdraw_proposal`, the two agent-side corrections to a pending outreach draft.

  `outreach_revise_proposal` rewrites the draft in place on the same proposal id — the contact and campaign are fixed, since a different recipient is a different proposal. A `reason` is required and the revision is recorded (`revisionCount`, `lastRevisedAt`, `lastRevisionReason`, revising actor), so an edit can never be silent. Proposals now also record the first time a human opens them for review; when a revision lands after someone else has already read the draft, `revisedAfterReviewAt` is stamped and both the dashboard review drawer and the MCP Apps inspector panel warn the reviewer that Wednesday's text is not the text they read on Monday.

  `outreach_withdraw_proposal` lets a curator retract its own pending draft — a duplicate, a prospect who turned out not to qualify, a bounced address — under a new terminal `withdrawn` status. Withdrawal is deliberately neutral: it does not suppress the contact, does not touch consent, and does not stop a campaign sequence, so a withdrawn follow-up leaves that step eligible again where a dismissed one ends the sequence for good. Slack approval cards resolve as withdrawn, and `skill://outreach/review-proposals` documents when each of the four verbs applies.

### Patch Changes

- Updated dependencies [5cb5ff3]
- Updated dependencies [4601314]
- Updated dependencies [e123820]
  - @getmunin/dashboard-pages@4.70.0
  - @getmunin/ui@4.70.0

## 4.69.3

### Patch Changes

- Updated dependencies [137fe87]
  - @getmunin/dashboard-pages@4.69.3
  - @getmunin/ui@4.69.3

## 4.69.2

### Patch Changes

- Updated dependencies [5b82be8]
  - @getmunin/dashboard-pages@4.69.2
  - @getmunin/ui@4.69.2

## 4.69.1

### Patch Changes

- @getmunin/ui@4.69.1
- @getmunin/dashboard-pages@4.69.1

## 4.69.0

### Patch Changes

- Updated dependencies [7078b30]
  - @getmunin/dashboard-pages@4.69.0
  - @getmunin/ui@4.69.0

## 4.68.0

### Patch Changes

- Updated dependencies [8da0e90]
- Updated dependencies [d4bfeb7]
- Updated dependencies [a66d454]
- Updated dependencies [cdff1ad]
- Updated dependencies [ed38e6c]
- Updated dependencies [47f509d]
- Updated dependencies [491186c]
- Updated dependencies [8037e74]
- Updated dependencies [3677620]
- Updated dependencies [8788bd4]
  - @getmunin/dashboard-pages@4.68.0
  - @getmunin/ui@4.68.0

## 4.67.2

### Patch Changes

- @getmunin/ui@4.67.2
- @getmunin/dashboard-pages@4.67.2

## 4.67.1

### Patch Changes

- @getmunin/ui@4.67.1
- @getmunin/dashboard-pages@4.67.1

## 4.67.0

### Patch Changes

- @getmunin/ui@4.67.0
- @getmunin/dashboard-pages@4.67.0

## 4.66.1

### Patch Changes

- Updated dependencies [3e0b921]
  - @getmunin/dashboard-pages@4.66.1
  - @getmunin/ui@4.66.1

## 4.66.0

### Minor Changes

- 44a9d34: Munin Inspector MCP App: new `@getmunin/inspector-app` package builds the `ui://munin/inspector` panel (React, single self-contained HTML, SDK bundled — no CDN) with an outreach proposal review view and the hello diagnostics view. New `outreach_approve_proposal` / `outreach_dismiss_proposal` admin tools expose the existing decision surface over MCP (declared panel-only via `_meta.ui.visibility: ["app"]` so MCP App hosts hide them from the model — sends require a human click); `outreach_list_proposals` and `inspector_hello` now declare `_meta.ui.resourceUri` so supporting hosts render the panel inline, with approve/dismiss round-tripping over the widget channel. Adds `skill://outreach/review-proposals`.
- 768642a: Localize the inspector panel from the MCP App host locale.

  - The panel reads `getHostContext()?.locale` after connect (falling back to `navigator.language`, then `en`) and re-renders on `onhostcontextchanged`, so it follows the user's Claude language setting rather than the iframe's browser default.
  - Strings live in a new `inspector.*` namespace in `@getmunin/dashboard-pages`' message catalogs (English + Norwegian), now exposed via a `./messages/*.json` export; the panel bundles only that namespace (~1 kB per locale) through a small `t(key, params)` helper.
  - Ages in the proposal ledger format through `Intl.RelativeTimeFormat` with the host locale instead of hardcoded English abbreviations.

  Server-originated strings (tool error messages) remain English.

### Patch Changes

- 45f0e56: Stop MCP App hosts' rounded iframe clipping from slicing the panel border. The panel applies the host's style variables and rounds itself with `--border-radius-lg` where available; on `platform: 'mobile'` hosts (which draw their own rounded card around the embed) it drops its outer border entirely and lets the host frame it. Hosts that send no style tokens keep the square Munin look.
- b84577f: Package the Tailwind theme and brand fonts in @getmunin/ui.

  - New `@getmunin/ui/tailwind-preset` export carries the whole Munin theme (token-mapped palette, semantic shadcn colors, radii, fonts, motion). Consumers shrink their Tailwind config to `presets: [muninPreset]` plus their own `content` globs; the OSS web app now does exactly that.
  - `styles/fonts.css` now resolves the woff2 files shipped inside the package (`src/fonts/`) via relative URLs instead of assuming the consumer hosts them at `/fonts/…`. Next emits them as hashed static assets; Vite (singlefile) inlines them. `apps/web/public/fonts` and the inspector-app's private font copies are gone.
  - The inspector-app build now compiles Tailwind (preset + PostCSS), so future panel views can use @getmunin/ui components directly; importing them through the barrel is tree-shaking-safe (`sideEffects` is now declared) and does not pull next-themes or sonner into the iframe bundle.

- Updated dependencies [fb104ce]
- Updated dependencies [768642a]
- Updated dependencies [04cab6d]
- Updated dependencies [b84577f]
  - @getmunin/dashboard-pages@4.66.0
  - @getmunin/ui@4.66.0
