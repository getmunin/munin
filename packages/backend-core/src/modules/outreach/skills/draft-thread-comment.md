---
title: "Outreach: Draft a public thread comment"
description: Draft a public comment on a forum thread for an engagement campaign — read the subreddit rules first, disclose the affiliation, answer the question. One comment per thread for the campaign's lifetime, under subreddit cadence caps, and only a signed-in person in the Munin dashboard can post it.
audiences: [admin]
---

# Draft a public thread comment

An **engagement campaign** (`kind: "engagement"`) answers public threads instead of mailing a CRM audience. It has no segment, no sequence, and no unsubscribe footer, because a thread has no data subject: nobody consented to be there, and nobody can be suppressed out of it. What replaces consent is restraint — subreddit rules, disclosure, cadence, and the fact that **you cannot post**.

**Posting is a dashboard-only action.** `outreach_approve_proposal` refuses every caller that is not a signed-in dashboard user, exactly as it does for calls and texts. A comment is public, permanent-ish, attributable speech under someone else's moderation, and one bad one gets the account banned and the domain shadow-listed. Draft, file, say it is waiting in the dashboard inbox, stop.

Two different acts live in an engagement campaign, and choosing wrong is the most common mistake:

| The useful response is… | Tool | Why |
|---|---|---|
| A public answer the whole thread benefits from | `outreach_propose_thread_comment` | No contact, no consent record — public speech in a public forum. |
| A private message to one person | `outreach_propose_first_touch` | That is ordinary contact-targeted outreach, with consent and suppression enforced. |

If the answer only helps the OP and reads as a sales approach, it is a DM, not a comment. If it reads as a sales approach in a DM too, don't send it.

## The pass

1. **Read the subreddit's rules before you draft.** Every subreddit has them, most ban promotion outright, many require flair or a specific disclosure format, some ban links. Fetch them, decide whether a comment from an affiliated account is welcome at all, and record what you read in `evidence` (rule text or a link plus the date). **A draft with no rule check in its evidence is not reviewable** — the operator cannot approve a comment without knowing whether it breaks the house rules.
2. **Qualify the thread against the campaign brief.** `outreach_get_campaign` gives you the brief. The thread has to be a genuine fit *and* be answerable helpfully by someone who happens to work here. A thread that merely mentions the category is not a fit.
3. **Check it is a question, not a fight.** Skip locked, removed, heavily-downvoted, and old threads; skip threads already arguing about vendors; skip threads where the OP has been answered well already.
4. **Draft** (rules below).
5. **File** with `outreach_propose_thread_comment({ campaignId, target, draftBody, evidence })`, where `target` is `{ threadId, permalink, subreddit, title, opHandle }`. The thread title becomes the subject in the review queue.
6. **Stop.** The operator posts it, or doesn't.

## Writing the comment

- **Disclose the affiliation in the comment itself**, in the first sentence or two, in plain language: "I work on Munin, so take this with the obvious grain of salt". Not in a footer, not implied, not omitted because the account name hints at it. Undisclosed affiliation is the single behaviour that turns an engagement campaign into astroturfing.
- **Answer the question first and completely.** The measure of a good comment is that it would still be useful with every mention of our product deleted. If deleting them empties the comment, don't file it.
- **Mention the product only when it is the direct answer**, once, without a pitch, and name the alternatives honestly — including the free or open-source one, including a competitor when it fits better.
- **No tracking links, no UTM parameters, no campaign CTA, no unsubscribe line.** Munin appends nothing to a comment; whatever you write is exactly what gets posted. A bare link to public documentation is usually fine where links are allowed at all.
- **Write in the thread's language and register.** Match how that subreddit talks. A corporate-voice paragraph reads as marketing whatever it says.
- **Short.** A comment that needs scrolling reads as content marketing.

## The limits the service enforces

- **One comment per thread, per campaign, for the campaign's lifetime.** A pending, approved or posted comment on that `threadId` makes a second proposal a conflict. There is no "bump", no second angle, no reply-to-your-own-comment follow-up: sequence steps are refused on engagement campaigns outright.
- **Subreddit cadence.** `maxPerWeekPerSubreddit` caps posted comments in one subreddit over the trailing 7 days; `maxCommentsPerDay` caps them across all subreddits over 24 hours. Both are re-checked at approve time, so a draft can be refused later than it was filed. Treat a cadence refusal as the answer, not as an obstacle: pick fewer, better threads next pass.
- **Quiet hours and blackout dates** apply to approval the same way they do to calls.
- **Both limits are ceilings, not targets.** Being under the cap is not a reason to file another comment.

## Replying after you have commented

When somebody answers our comment, the exchange lands in the same conversation and `outreach_propose_reply` works there — a reply continues an exchange the other person chose to have, so it is not a second cold comment. The same disclosure and helpfulness rules apply, and one pending reply draft per conversation. If the reply would be a pitch, or if the thread has turned hostile, propose nothing.

## What not to do

- **Don't file a comment on a subreddit whose rules you haven't read.**
- **Don't hide the affiliation**, and don't bury it below the pitch.
- **Don't seed a question and answer it.** Both halves are the same account, and it is the fastest route to a permanent ban.
- **Don't work around a conflict or a cadence refusal** by re-filing under a different campaign, a different thread in the same discussion, or a reworded target.
- **Don't add a link the subreddit forbids** and leave the operator to notice.
- **Don't propose at volume.** Ten drafted comments in one pass is a spam run whatever each one says.

## Related

- `skill://outreach/review-proposals` — what the operator does with what you filed, and why you cannot do it for them.
- `skill://outreach/draft-first-touch-email` — the contact-targeted pass, where consent and suppression do the work cadence does here.
