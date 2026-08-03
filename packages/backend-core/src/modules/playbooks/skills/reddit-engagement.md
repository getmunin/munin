---
title: Playbook: Reddit engagement (Conv + Outreach + CRM)
description: Probe Reddit for threads where the product is genuinely relevant, qualify them against the campaign brief and the subreddit's own rules, then propose either a public comment or a DM to the OP for human approval.
audiences: [admin]
---

# Reddit engagement (Conv + Outreach + CRM)

Cross-module workflow: find public threads where you can actually help, and turn the good ones into one approved comment or one approved DM.

This is a **playbook** — it composes per-module skills rather than reproducing them. Read `skill://conv/setup-reddit-channel` before executing; the channel must exist and be active.

Munin does no prospecting on its own. Nothing here happens on a timer and nothing sends without a person clicking approve. The loop is: **probe → qualify → decide → propose → (human approves) → converse.**

## Why this one needs judgment

Every other outreach channel addresses a mailbox. Reddit addresses a *community*, and communities eject vendors who treat them as a lead source. The rate limits are not the binding constraint — moderators and the spam filter are. A shadowban is invisible: your comments post successfully, return a real id, and simply nobody sees them. There is no API that tells you this happened.

So the rule that matters is not a quota. It is: **would this comment be worth posting if it were unattributed and sold nothing?** If no, don't propose it.

## 1. Probe

`conv_search_reddit_threads` with the channel's `channelId`, a subreddit and/or keywords drawn from the campaign brief.

Search for the *problem*, not the product. People asking "how do I keep customer emails and my CRM in sync" are reachable; people saying "Munin is great" need nothing from you. Prefer threads that are recent, unanswered or thinly answered, and phrased as a question.

`conv_get_reddit_thread` on candidates to read the post and the existing replies. Read them. If someone has already given the answer you were going to give, there is nothing to add — move on. A thread that is days old with a settled accepted answer is not worth a late vendor comment.

## 2. Qualify — subreddit rules first, always

`conv_get_subreddit_rules` **before** drafting, every time, per subreddit. Do not cache a judgment from another campaign.

Read them for three things:

- **Self-promotion.** Many subs ban it outright; some allow it only in a weekly thread; some allow it with disclosure. "No self-promotion" means you do not comment mentioning your product, even helpfully. Respect it; the campaign is not more important than the sub's rules.
- **DMs.** Some subs explicitly forbid DMing members about threads. That forbids the DM path here, whatever the OP's inbox settings allow.
- **Account age / karma gates.** Some subs auto-remove posts from new or low-karma accounts. If the channel's account doesn't clear the bar, a comment will be silently removed — don't spend the thread on it.

Then qualify against the brief: is this person's problem one the product actually solves? Not "adjacent to". If you have to stretch, the comment will read as a stretch.

**Attach the rules you read to `evidence`** on the proposal, along with the thread's permalink and what in the thread made it qualify. The human approving needs to see what you checked, and the next agent working this campaign needs to know the rules were read and when.

## 3. Decide — comment or DM

**Default to the public comment.** It is the socially legitimate move: the question was asked in public, the answer belongs in public, and everyone who finds the thread later benefits. It is also accountable — if it's a bad comment, the sub tells you immediately.

**DM the OP only when a public reply would be off-topic or forbidden** — the sub bans self-promotion but not DMs, or the useful answer requires account-specific detail that has no business in a public thread.

Understand what the DM path actually is before choosing it. Munin sends via Reddit's legacy private-message API, so the message lands in the OP's **Messages** inbox — not Reddit Chat, which most people actually read. A successful send is not a delivered-to-attention. Unsolicited DMs are also the fastest route to a spam report. It is the riskier move and it reaches fewer people; pick it deliberately, not because it feels more direct.

Never do both for the same thread.

## 4. Propose

**Public comment** — `outreach_propose_thread_comment` on an `engagement` campaign, with the target (`threadId`, `permalink`, `subreddit`, `title`, `opHandle`), the draft, and the evidence from step 2.

There is no consent check on this path and that is deliberate: a public post has no data subject to consent. What governs it instead is the campaign's `maxPerWeekPerSubreddit` / `maxCommentsPerDay` cadence, and a hard rule that a campaign gets **one comment per thread** — enforced in the database, not on trust. If a proposal comes back as a conflict, the campaign already has a live or posted comment there. Don't work around it by proposing under a second campaign.

**DM to the OP** — this is person-directed outreach and it takes the normal consent path:

1. `crm_lookup_contact` by `handle`, then `crm_create_contact` with `handle` set (bare username, no `u/`) if they're new.
2. Record a lawful basis before proposing — `crm_set_contact_consent` with `legitimate_interest` and, in the evidence, the thread where they publicly asked about this problem. That thread *is* the basis; without it there isn't one.
3. `outreach_propose_first_touch` against a Reddit-channel campaign.

Munin never appends an unsubscribe footer on Reddit — a tracking URL in a cold DM is a spam signal, and Reddit is not email. So say it in the message instead: one plain line that they can reply "stop" and you'll leave them alone. When anyone asks to be left alone, in a DM or in public, set `doNotContact` on their contact immediately. That is the whole opt-out mechanism; there is no automated one behind it.

## Writing the draft

- **Disclose the affiliation in the comment itself**, unprompted, in the first sentence or two — "I work on X" — not in a footer, not only if asked. Undisclosed vendor comments are the single thing that gets accounts and domains banned.
- **Answer the question first.** If the comment is still useful with the product mention deleted, it's a good comment. If deleting the mention leaves nothing, it's an ad.
- Match the sub's register. No marketing voice, no bullet-point pitch deck, no "Great question!".
- Link only if a link is the answer, and prefer docs over a landing page.
- Never claim a capability the product doesn't have. Someone will check.

## 5. Converse

Once approved, Munin posts and the thread becomes a normal conversation. Replies from anyone in that thread — not just the OP — ingest into it, each attributed to their own contact. `conv_list_conversations` and the standard reply flow apply from there; a reply to someone who answered you is an ordinary reply, not new cold outreach, and it does not consume the one-comment-per-thread budget.

Munin also refreshes the score and reply count of comments it posted. Treat a heavily downvoted comment as what it is: the sub telling you the comment was unwelcome. Stop working that subreddit and revisit the brief rather than posting a second one.

## What not to do

- Don't bump a thread with a follow-up comment because the first got no reply. There are no sequence follow-ups on threads and that is on purpose — comment-bumping reads as spam and invites a ban.
- Don't propose across many subreddits at once to spread volume. Cadence limits are per subreddit because the *sub* is the community that notices; total volume is what looks like a campaign.
- Don't create a second campaign to get a second comment in a thread you already commented in.
- Don't DM someone who ignored your public comment.
- Don't touch Reddit Chat. It has no API; Munin cannot see or send there, so a customer expecting replies to arrive in Chat will be disappointed.
- Don't treat search volume as progress. Ten good comments a month from an account with real standing beats a hundred that get filtered.

## Related

- `skill://conv/setup-reddit-channel` — BYOK app registration, account warming, pacing.
- `skill://outreach/draft-thread-comment` — drafting the comment itself.
- `skill://outreach/review-proposals` — what the human sees at approval.
- `skill://crm/clean-contact-data` — handle as a dedupe key.
