---
'@getmunin/backend-core': minor
'@getmunin/types': minor
---

Surface social post drafts in Slack for approval.

A pending draft now posts an approval card alongside the CRM, outreach and KB ones: platform, variant, suggested author, the body quoted inline, the tracked share link, and a character count against the platform limit. *Publish to LinkedIn* posts it; *Dismiss* discards it; the card resolves in place whichever surface decided it.

The card states on its face that publishing posts from the clicking teammate's own connected account, not the suggested author's. That is the one thing about this feature people get wrong, and Slack makes it easier to get wrong than the dashboard does — the suggested author's name is right there, and the button is not theirs. A teammate with no connected account gets an ephemeral pointing at Settings → Integrations, and the draft stays pending.

The social module had emitted no events at all, so there was nothing for the Slack sink to pick up. It now emits `social.post_draft.{proposed,revised,published,dismissed,failed}`.

Two details worth recording:

A publish result must survive the request that threw. The platform call and the status write happen in a root transaction, so a `failed` marker written inside the request transaction and then thrown out of would roll back with the error — the same trap as marking a connector connection `expired`. Both the published and failed events are therefore emitted from inside that root transaction, which is also what closes the Slack card on a refusal instead of leaving a live Publish button over a terminally failed draft.

A Slack card is a cached rendering, so `publishDraft` takes an optional fingerprint over the platform, body and link. Slack binds its button to the wording it rendered and a revised draft refuses rather than posting text nobody approved. The dashboard and the MCP tool read the draft live and pass nothing, so their behaviour is unchanged.

Variants of one set thread under a parent, the way outreach proposals thread under a campaign. A set is one post written several ways and you publish exactly one of them, so three loose cards each with a live Publish button is the wrong shape. A one-off share is a set of one and posts with no parent.

Publishing a variant now dismisses the rest of its set, in the same transaction, with `superseded: variant <label> was published instead` recorded as the reason; `social_mark_draft_posted` settles the set the same way. This is a behaviour change for the dashboard and MCP as much as for Slack: previously siblings stayed pending and two wordings of the same post could go out twice. A failed publish settles nothing — the set stays open for another attempt — and nothing crosses a set boundary. The skill said Munin did this before it actually did; now it does, and the sibling cards resolve as dismissed alongside the published one.
