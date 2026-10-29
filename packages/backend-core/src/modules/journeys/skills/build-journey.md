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
- **Mark transactional email honestly.** `class: "transactional"` reaches unsubscribed contacts, so use it only for messages the contact needs to use the product (receipts, password or account notices), never for promotion.
- **Give every `wait_for` an `onTimeout`.** Without it, contacts whose event never comes simply leave.
- **Use `onReply` on emails that invite an answer.** A reply always pauses the contact's run; Conversations answers it, and the journey continues on `onReply`, or at the same point once the thread closes.
- **Loops need a wait.** A `jump` back must pass through a `wait`, `wait_for` or `message`; each node also has a per-contact visit cap (`settings.maxVisitsPerNode`).
- **Respect quiet time.** Set `settings.quietHours` and `settings.timezone` for the market you are writing to.

## Hand it over

When `journeys_validate` returns no errors, summarise for the operator: who enters and when, each path, every email subject, the goal, and anything you assumed. Then stop. Do not try to publish it yourself.

To change a live journey, edit as above: the edits open a new draft version, and contacts already in the journey finish on the version they entered. To roll back, `journeys_restore_version` copies an earlier version into the draft, which again needs publishing. `journeys_pause` holds a live journey without removing anyone; `journeys_archive` retires it.
