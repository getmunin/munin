---
'@getmunin/dashboard-pages': minor
'@getmunin/backend-core': minor
---

Edit a social draft from the review pane, the way a CMS draft is edited.

The Fields tab was read-only: the post text arrived from the agent and the only way to
change a word was to ask the agent for a revision. It now has the CMS pane's edit
affordance — an "Edit" action in the footer that turns the post into a textarea and the
footer into Save/Cancel, with ⌘↵ to save and esc to cancel.

Two fields are editable, because two are all the draft lets anyone change: the post body,
and — when the link is placed in the first comment — the comment text, which is offered
even on a draft that has none yet. The share link and the attachment stay read-only: the
link carries per-variant UTM tagging assigned when the draft was filed, and an attachment
is a file, not a string to retype.

The comment text needed a control-plane route of its own. `PATCH /v1/social/drafts/:id`
revises the body; the new `PATCH /v1/social/drafts/:id/link-placement` is a thin wrapper
over `setDraftLinkPlacement`, the same service method `social_set_post_draft_link_placement`
calls, so the two surfaces stay in step. A save sends only the fields that actually changed.

The character count beside the post is computed locally while typing, using the rule the
server measures by — LinkedIn shortens links so they cost nothing, Facebook counts every
character — so the count in the header and the over-limit warning agree with the error the
API would return, and Save stays disabled until the body fits. The Preview tab renders the
unsaved text, so flipping between the two tabs while editing shows the post as it is being
written.

The field labels above each box are now bottom-aligned with their copy button rather than
centred on it, so "Post" and "Link to share" sit the same distance above their box as
"Attached" does above a box with no button at all.

`PaneFooter` also stops inventing its own footer grammar, and adopts the CMS pane's.

It rendered its buttons at `size="sm"` (28px) on a `py-3` row while every hand-rolled pane
footer — CMS, and the review page's CRM, outreach and KB panes — uses the default 36px
button on a `py-4` row, so the social and feedback panes sat visibly shorter than their
neighbours. `ScheduledFooter` had the same pair and follows along.

Its secondary buttons were also styled by position — the first solid, the rest outlined —
which made "Edit" the loudest thing in a footer whose accent button is the actual decision.
Each action now names its own variant, defaulting to `outline`, and every dismiss and
cancel asks for `ghost`: accent for the decision, outline for the other real actions, ghost
for the way out, exactly as `cms.tsx` writes it by hand.

The primary button takes an `arrow` flag, which the feedback and social panes set. Their
review-page neighbours (CRM's "Apply merge →", outreach's "Approve & send →", KB's
"Publish →", CMS's "Approve →") all carry the arrow that marks the action moving the item
forward; those two were the only decision buttons without one.

One alignment bug in the preview goes with it: the author block hung off the top of the
avatar rather than centring on it, because the header row is `items-start` and the
name-plus-timestamp pair is shorter than the picture beside it. It showed worst on
LinkedIn, whose 48px avatar left the 38px text block sitting 5px high. Both cards now
centre that column against the avatar, and the row stays `items-start` so each network's
overflow control keeps its place at the top.
