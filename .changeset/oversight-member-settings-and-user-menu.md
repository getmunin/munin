---
'@getmunin/dashboard-pages': patch
'@getmunin/agent-runtime': patch
'@getmunin/backend-core': patch
---

Settings is admin-only, the console sidebar grows a user menu, and mobile stops hiding its own controls.

A support agent used to keep Workspace → Account in the settings nav, whose only content is the organization name — an admin-only field. `PATCH /v1/orgs/me` already carried `@RequireRole('owner','admin')`, so the form was never a hole; it was a dead end that always ended in a 403. Settings now filters out for non-admins in both the console nav and the settings shell, `/dashboard/settings/*` bounces a member to conversations, and the system-alert banner drops its call to action for members since every target is a settings page they can no longer reach.

Signing out no longer lives at the foot of the settings nav, since a member can no longer reach it. Both the desktop sidebar and the mobile menu sheet now end with the signed-in user — avatar, name, and an overflow menu holding Sign out — sharing one footer component instead of the sheet-only variant that existed before.

The membership cache is keyed to the session user, so signing out as an owner and back in as a member reflects the new role without a hard refresh; previously the module-level cache survived the client-side navigation through `/login` and kept serving the first user's role.

A draft is only produced when the customer wrote the last public message. Asking otherwise gives the agent nothing to answer, and the draft comes back greeting whoever spoke last — a teammate, by name, as though they were the customer. The runtime labels operator turns correctly as `[Human teammate]`, so this was an ill-posed request rather than a misread transcript. The runtime now enforces that in every mode and the dashboard hides "Ask for a draft" on the same condition, so the button never offers a request the runner will drop. Internal notes never count as the last word.

Three paths previously disagreed. The on-demand path was exempt from the check entirely, which is how a draft could be requested with nothing to answer. The automatic path treated an operator's own message as something to reply to, reachable once a claim expired. And a draft request after the agent had already replied was allowed as a deliberate "follow-up proposal" — a feature dropped here in favour of one rule that holds everywhere, since a button offering a follow-up is indistinguishable from one offering a reply.

"Ask for a draft" is gated on holding the claim rather than merely on the conversation being open, so it no longer sits beside "Claim to reply" offering an action that lands in someone else's lane. That leaves the unclaimed footer with just the claim button, and the one remaining call in that branch was dead code once the condition tightened.

The unclaimed conversation's caption is gone — the "Claim to reply" button beside it already said the same thing, so the sentence explaining that claiming is needed to reply was restating its own call to action. The caption naming a teammate who already holds the claim stays, since that one carries information the button does not.

A claimed conversation whose last public message is from the customer now sorts under "Needs your attention" rather than "In progress". The section was driven entirely by the persisted `needsHumanAttention` flag, which nothing sets when a customer simply answers a thread you already hold, and the queue payload carried no notion of who spoke last — so the read model gains a derived `endUserSpokeLast` rather than widening what that flag means. It stays scoped to conversations you hold; extending it to unclaimed rows would sweep in every unanswered auto-mode thread.

The queue's tally strip above the list is gone, along with its three strings in both locales. Each section already states its own count in its heading, so the strip restated them a second time before the list had even started.

An empty "Needs your attention" drops its heading rather than announcing that nothing needs you; the queue reads as a list of work, and a section that is always present but usually empty is noise. Its message is deleted from both locales.

A closed conversation offers a Reopen button instead of only stating that it is read-only, which left the dashboard with no way back from a close — the status endpoint already accepted `open`, nothing surfaced it. Both the mobile and desktop composers share one footer for that state.

Returning to the queue works after reloading a conversation directly. The detail route passes its id as a prop, and the pathname match fell back to that prop the moment the URL became the queue's — so the back control rewrote the URL while the pane stayed put. The queue's own path is now authoritative over the prop, which only ever mattered on a reload since a client-side visit renders the queue route with no prop at all.

The full-screen mobile composer no longer hides its own send button behind the keyboard. It was `fixed inset-0`, which measures the layout viewport — but an on-screen keyboard shrinks only the *visual* viewport, so the actions sat underneath it and had to be scrolled to. The overlay now covers the whole layout viewport so nothing shows through beneath it, while an inner wrapper tracks `visualViewport` height and offset through CSS variables — collapsing to `display: contents` above the mobile breakpoint so the desktop composer keeps its original layout. The composer's header carries the conversation's subject and topic instead of just the customer's name.

On mobile the conversation's own header is gone, and its title and topic move into the app bar beside the back arrow, which is the only chrome a phone has room for. The bar takes them through the same context the back action already travels on. Its detail line and identifier stay desktop-only.

On mobile the shell was measured with `h-screen`, whose `100vh` ignores the browser's own chrome on iOS, so the conversation footer — "Claim to reply" — sat underneath Safari's toolbar and could not be tapped. The shell and the document body now measure in `dvh`. The conversation pane's back link also moves out of the column header into the app header, where it replaces the hamburger for the duration of the detail view, via a small context any page can use to publish a mobile back action.
