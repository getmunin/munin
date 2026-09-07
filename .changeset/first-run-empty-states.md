---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
'@getmunin/ui': minor
---

First-run and empty states for Overview, Conversations, Automation and Learning

A brand-new org used to land on a dashboard of zeroes: a hero that said agents were
caught up, two stat rows reading 0, and five empty usage tiles. Nothing told you that
no channel was connected, or that the two things worth doing were pointing an agent at
`/mcp` and opening a way in.

The four console pages now render a first-run scene instead, driven by one shared
source of truth. `GET /v1/overview/setup` (new `SetupStateService`) reports the org's
channels, all-time conversation count, topic count, knowledge-base size and external
MCP tool-call activity in a single request. `useSetupState` turns that into
a `stage` — `unconfigured` (no channel can accept a message), `listening` (a channel is
live, nothing has ever arrived) or `active` — and pages branch on `setup.isFirstRun`
so an established org keeps exactly the behaviour it had.

Setup state is fetched from a `SetupStateProvider` mounted in `DashboardShell` rather
than per page. Fetching it per page meant every console navigation remounted the hook,
started from "unknown", and rendered the established-org layout for a frame before
flipping to the empty state — a visible flash on every switch. Pages now also render
nothing rather than the wrong branch while the answer is still undetermined, so the
wrong frame never reaches the screen.

The provider revalidates on navigation, keeping the last snapshot on screen while the
refetch is in flight, so connecting a channel in settings and walking back to the
console shows the new channel without a reload. Channel mutations emit no realtime
event, so navigation — not the event stream — is what makes that flow correct; a
channel opened by an agent while you sit on Overview still lands on the next
navigation rather than instantly.

"Has an agent been pointed at the endpoint" counts only *external* callers. Munin's own
in-process runner reaches the same tools, so a first count of every non-system
`audit_log` row with a tool set reported 35 calls — and a green "done" — for an org
where nobody had ever connected anything. `externalMcpCallCount` now excludes the
`agent-host` actor and its per-end-user variants alongside the system actors, reusing
the `@getmunin/types` actor constants rather than restating the prefixes. The step
counter is derived from the same two facts in both stages, so a live channel with an
untouched endpoint reads "1 of 2 done" instead of claiming both.

The derivation is a pure function (`toSetupSnapshot`) with its own tests: stage
transitions, channels awaiting credentials counting as pending rather than live, the
endpoint counting as connected only once an external tool call is recorded, and channel
labels falling back from public address to channel name.

The scenes are built from a small reusable set — `FirstRunScene`, `FirstRunSteps`,
`FirstRunChain`, `FirstRunStatusList`, `FirstRunFigures`, `FirstRunAside`,
`FirstRunNote` and the shared `CopyField` — so all four pages share one editorial layout
rather than four bespoke empty states. `@getmunin/ui` gains an `accentOutline` button
variant for the quiet cobalt CTA these screens use.

The endpoint is readable by any org member, since Conversations is the one console
page members can open and its empty state has to distinguish "no channel connected"
from "connected, nothing has arrived". It returns counts and public channel config
only — the same redaction `conv_list_channels` applies.

The endpoint field became the shared `CopyField`: a mono value with the Copy control
attached inside one hard-edged ink border on `paper-deep`. `CopyableSecret` is now that
field plus a label and hint, `KeyReveal` on api-keys and the webhook-secret field on
channels use it directly, and `channels.tsx` no longer shadows `CopyableSecret` with a
local copy of its own — that duplicate is what kept the widget-key and Twilio dialogs
on the old rounded `bg-background` look while the rest of the console moved on. The
multi-line embed snippets in channels and trackers keep their button underneath, since
an attached control makes no sense on a code block, but their surface now matches. The
Copy control sizes itself to the wider of its two labels by rendering both in one grid
cell, so the field does not shift when Copy becomes Copied — and it stays correct in
Norwegian, where "Kopiert" is a character longer than the English word. The email
channel form's SMTP and IMAP fieldsets lost their `rounded-md` corners, and
`--munin-radius-input` drops from 2px to 0, so inputs, textareas and every
`rounded-input` surface are hard-edged like the rest of the system.

The four first-run scenes were then measured rather than eyeballed, at both widths and
in both stages: scene gap, page padding, every inter-block gap and each closing rule.
Two arbitrary differences fell out and are fixed — `FirstRunFootnote` closed on 20px
where `FirstRunNote` closed on 24px despite playing the same structural role, and the
chain's mobile number gutter was 44px against the steps' 52px even though both land on
76px from `md` up. What remains different is deliberate: Conversations closes on a soft
rule (a caveat) where the other pages close on an ink rule (a statement), and its
listening stage has no closing line at all, ending on the test affordance the way the
design does.

Copying the endpoint no longer crashes outside a secure context. Every copy button in
the dashboard reached for `navigator.clipboard.writeText` directly, and that object
does not exist on a plain-HTTP origin — so pressing Copy on a LAN dev host threw
`Cannot read properties of undefined (reading 'writeText')`. A shared `copyText` helper
now falls back to a selection copy and reports failure instead of throwing, and a
`useCopy` hook owns the "Copied" flag and its timeout. Both replace the eight
hand-rolled copies of that logic across api-keys, channels, trackers and
`CopyableSecret`.

"Send a test message" on the listening screen is a real feature rather than a mock.
`POST /v1/conversations/test-message` opens a conversation on the org's first live
channel with an inbound end-user message, flagged `setupTest` in conversation metadata
and surfaced as `isTest` on the conversation DTO. It goes through `createConversation`,
so the whole pipeline runs — classification, drafting, the lot — which is the point of
a test. Nothing is delivered outbound, because an `end_user`-authored first message
never enqueues delivery.

The test conversation is a real conversation, so the console takes over from the
first-run screen the moment it lands and you watch it arrive. `DELETE
/v1/conversations/test-message/:id` removes it — refusing any conversation not carrying
the flag — and the pane shows that action in a banner while a test is open. Deleting
returns the org to zero conversations and the first-run screen comes back, so the whole
loop is reversible. Both endpoints are owner/admin only, which is why
`ConversationsController` now includes `RoleGuard` (a no-op for its existing methods,
none of which declare roles).

The banner reports the delete to the page rather than acting on it. Navigating and
refetching from inside the banner left the queue holding a conversation the server had
dropped, so the pane stayed mounted and its button span forever; and the shared
setup-state revalidation is throttled, so a delete within a couple of seconds of
opening the conversation silently skipped it and the console rendered its ordinary
empty state instead of returning to first run. `ConversationsPage` now owns the
aftermath — shallow-navigate to the queue, refetch the queue, force a setup reload —
which is the same sequence it already uses for every other conversation-level action.

The Done section is now bounded by both count and age: everything closed inside
`FINISHED_WINDOW_DAYS` (7) stays, and at least `FINISHED_MIN_ITEMS` (25) stays even when
older, so a quiet week still shows history and a busy one does not hide it. It was
previously a flat 25-of-any-age, which meant a busy org silently lost recent rows while
a quiet one showed conversations closed a year ago. `visibleFinished` expresses the
union as a pure function over the already-sorted page and is unit-tested on both
branches, the window edge, and undated rows. The closed page now fetches 100 rather
than 25 so the window has room; past 100 closed inside a week the section is capped,
since the endpoint's cursor is still unused by this page.

One caveat: a test conversation counts in usage tiles and can pick up a topic like any
other, so the copy promises only that it is marked as a test and deletable — not the
design's "counts toward nothing".

The Overview hero greets you by name. The headline was a fixed line about waiting on
your word regardless of who opened the page or when; it now reads "Good morning,
_Kjell_." — four buckets split at five, noon and six, first name in the same cobalt
italic the old emphasis used, with the state left in the lede where it already lived.
The small hours get their own line ("Still up, _Kjell_?") rather than being folded
into a morning that would otherwise start at midnight. `firstName` falls back to the
unpersonalized headline rather than guessing: a blank name, an email in the name field
(BetterAuth allows it), or a first token over 24 characters all keep the old line, so
the hero never addresses someone by their address or overflows. The Norwegian
greetings are transcreated to what reads naturally there — morgen, ettermiddag, kveld,
and "Fortsatt oppe" for the night — rather than mapping one-to-one onto the English
buckets.
