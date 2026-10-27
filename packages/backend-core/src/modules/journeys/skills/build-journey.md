---
title: Build a journey
description: Turn a lifecycle goal ("convert trial users who invited no colleagues by day 5") into a journey draft on an email outreach campaign — entry, waits, branches, emails, actions and a goal — then validate it. Agents draft and edit; publishing always needs a signed-in person in the Munin dashboard.
audiences: [admin]
---

# Build a journey

A journey is a versioned graph that moves each contact through triggers, waits, branches, emails and actions towards one goal. It wraps one email outreach campaign: the campaign supplies the sending channel, brief, cadence rules and outcome-extraction fields, and the journey supplies the graph.

**You draft; a person publishes.** Every edit lands in the journey's open draft version. Published versions never change. Nothing reaches a customer until someone signed in to the Munin dashboard publishes the draft, so when the draft validates cleanly, say it is ready for review and stop.

## Before you draft

1. Read `journeys_list_node_types`. It is the reference for every node, the entry block, exit rules, goal and settings.
2. Find the signals the journey can use:
   - Product events the org's backend sends: `analytics_list_product_event_names`. Only names listed there will ever arrive; ask the operator before relying on one that is not.
   - Saved audiences: `crm_list_segments`. Segment filters can include behaviour, for example "did not trigger `teammate.invited` within 5 days".
   - Email layouts: `outreach_list_email_templates`.
3. Pick the campaign with `outreach_list_campaigns`. It must use an email channel and can carry only one journey. Create the campaign first with `outreach_create_campaign` if none fits.

## Draft it

1. `journeys_create` with a name, the campaign id and, if you already know the shape, a whole `spec`.
2. Refine with small edits: `journeys_add_node`, `journeys_update_node`, `journeys_remove_node`, and `journeys_update_settings` for `start`, `entry`, `exit`, `goal` and `settings`. Use `journeys_replace_draft` when restructuring most of the graph.
3. `journeys_validate` after each round of edits. Fix every error; read the warnings and fix the ones that are mistakes.

Rules that keep a journey safe and readable:

- **Name a goal.** `goal.event` and `goal.windowDays` are required. Success is measured as goal conversion, not opens.
- **Keep emails in `draft_only`.** Each email is then filed for review in the outreach inbox before it is sent. Only the person publishing a version decides that a fixed-content email may use `auto`.
- **Text messages go through a person every time.** A `message` node with `channel: "sms"` sends from the SMS channel in `settings.smsChannelId` (find it with `conv_list_channels`), so one journey can mix email and SMS. It carries only `content.body` (at most 480 characters, `{{name|fallback}}` allowed, an opt-out line is added to marketing texts), cannot use `auto` or an agent draft, and goes to a signed-in reviewer before it is sent. Use it for short, timely nudges — a reminder the day before a webinar — not as a second copy of every email.
- **Mark transactional email honestly.** `class: "transactional"` reaches unsubscribed contacts, so use it only for messages the contact needs to use the product (receipts, password or account notices), never for promotion.
- **Give every `wait_for` an `onTimeout`.** Without it, contacts whose event never comes simply leave.
- **Use `onReply` on emails that invite an answer.** A reply always pauses the contact's run; Conversations answers it, and the journey continues on `onReply`, or at the same point once the thread closes.
- **Read replies with an intent step.** Point the email's `onReply` at an `agent` node in `decide` mode with `inputs: ["reply", "thread", "contact"]`, edges such as `interested`, `question`, `not_now` and `stop`, and `fallback: "question"` — the safe path where a person or the support agent answers and the journey waits. Choosing `stop` also ends every other journey the person is in.
- **Start from a conversation topic** with an event trigger on `conversation.topic_set` and `where: { "topicSlug": "pricing" }`; list topics with `conv_list_topics`.
- **Loops need a wait.** A `jump` back must pass through a `wait`, `wait_for` or `message`; each node also has a per-contact visit cap (`settings.maxVisitsPerNode`).
- **Respect quiet time.** Set `settings.quietHours` and `settings.timezone` for the market you are writing to.

## Prove it, then hand it over

1. `journeys_simulate` runs the draft over real contacts without sending anything: who would enter or be excluded and why, where each person goes, what every email would do (send, wait for quiet hours or a cool-down, or be skipped because the contact is unsubscribed or undeliverable) and rendered samples. Read its `assumptions`: waits are assumed to elapse, awaited events not to arrive, and reviewers to approve.
2. Fix what surprises you, then `journeys_request_publish`. It refuses a draft with validation errors and returns the diff against the live version, listing every email that would send without review (`autoNodes`).
3. Summarise for the operator: who enters and when, each path, every email subject, the goal, the simulation counts and anything you assumed, and give them the `reviewPath`. A signed-in person confirms the publish there; you cannot. Editing the draft afterwards cancels the request, so request again after any change.

After it goes live, `journeys_get_report` shows enrollments, exits, goal conversion against the holdout and how each node and email performs.

To change a live journey, edit as above: the edits open a new draft version, and contacts already in the journey finish on the version they entered. To roll back, `journeys_restore_version` copies an earlier version into the draft, which again needs publishing. `journeys_pause` holds a live journey without removing anyone; `journeys_archive` retires it.
