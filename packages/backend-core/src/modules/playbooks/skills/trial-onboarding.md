---
title: Playbook: Trial onboarding journey (Journeys + Analytics + Outreach)
description: Launch a journey that welcomes every new trial user, checks after five working days whether they invited a colleague, flags likely buyers for sales and offers help to the rest — then watch it run until the first-journey gate is met (no duplicate sends, a complete trace for everyone).
audiences: [admin]
---

# Trial onboarding journey (Journeys + Analytics + Outreach)

Cross-module workflow: the product's own backend reports trial sign-ups and invitations; a journey turns those signals into a welcome email, a sales flag for decision-makers and a help email for people who stall. It is the reference journey for a first launch, because it touches every part of the engine: an event trigger, a timed wait on working days, behaviour and field branches, an action, emails in both review modes, a reply path and a goal.

This is a **playbook** — it composes per-module skills rather than reproducing them. Read `skill://journeys/build-journey` before executing.

## TL;DR

1. Make sure the product sends `trial.started`, `teammate.invited` and `subscription.started` to `POST /v1/events`.
2. Pick the email channel to send from and create a "Trialists" segment.
3. Build the journey below with the `journeys_*` tools, validate and simulate it.
4. `journeys_request_publish` and hand the `reviewPath` to the operator. They confirm in the dashboard.
5. Watch `journeys_get_report` daily for the first two weeks; the launch gate is met when integrity stays at zero.

## Step 1 — the events

`analytics_list_product_event_names` shows which names have arrived in the last 30 days. You need:

| Event | Sent when | Used for |
|---|---|---|
| `trial.started` | A trial account is created | Entry |
| `teammate.invited` | The trial user invites a colleague | Branch: did they invite anyone since entering? |
| `subscription.started` | The account starts paying | Goal |

If any is missing, tell the operator which event their developers must send. The request is `POST /v1/events` with an admin API key that has only the `analytics:write` scope, a body `{ "events": [{ "id", "name", "occurredAt", "identity": { "email" | "externalId" | "contactId" }, "properties" }] }`, and the caller's own unique `id` per event so retries never count twice. Do not build the journey on events that never arrive.

## Step 2 — audience and sender

- A segment of people who may receive onboarding email, for example `tagsAny: ["trial"]` (`crm_create_segment`). Segment members must have a recorded lawful basis; contacts without one never enter.
- An active email channel to send from (`conv_list_channels`, type `email`). It becomes the journey's `senderChannelId`.

## Step 3 — the journey

Create it with `journeys_create`, the email channel as `senderChannelId` and this spec, replacing the segment id, then adjust copy and timing with the operator:

```json
{
  "entry": { "trigger": { "type": "event", "event": "trial.started" }, "segmentId": "<trialists segment id>" },
  "goal": { "event": "subscription.started", "windowDays": 30 },
  "exit": { "idleDays": 30, "on": [] },
  "settings": { "timezone": "Europe/Oslo", "quietHours": "20:00-08:00", "holdoutPct": 10, "frequencyCapPerWeek": 3 },
  "start": "welcome",
  "nodes": [
    { "id": "welcome", "type": "message", "channel": "email",
      "content": { "subject": "Welcome to the trial", "body": "Hi {{name}}, here are three things to try today." },
      "next": "wait5" },
    { "id": "wait5", "type": "wait", "duration": "P5D", "validDays": ["mon","tue","wed","thu","fri"], "validHours": "09:00-16:00", "next": "invited" },
    { "id": "invited", "type": "branch",
      "rules": [{ "if": { "event": "teammate.invited", "since": "entry" }, "next": "done" }],
      "default": "decision_maker" },
    { "id": "decision_maker", "type": "branch",
      "rules": [{ "if": { "field": "contact.title", "op": "in", "value": ["CEO", "CTO", "Founder"] }, "next": "flag_sales" }],
      "default": "offer_help" },
    { "id": "flag_sales", "type": "action", "action": "crm.add_tag", "params": { "tag": "trial-sales-lead" }, "next": "done" },
    { "id": "offer_help", "type": "message", "channel": "email",
      "content": { "subject": "Can we help you get started?", "body": "Hi {{name}}, most teams get more out of a trial once a colleague joins. Want a hand setting it up?" },
      "next": "done", "onReply": "replied" },
    { "id": "replied", "type": "action", "action": "crm.log_activity", "params": { "subject": "Replied to trial help email" }, "next": "done" },
    { "id": "done", "type": "exit" }
  ]
}
```

Both emails start as `draft_only`, so each lands in the review inbox. For the first live week keep it that way: every welcome email gets a human read. The operator may later publish a version where `welcome` uses `auto`; never switch `offer_help` to `auto` without their explicit say.

Then `journeys_validate` (no errors) and `journeys_simulate` over the segment. Report the counts, the email decisions and the assumptions to the operator; ask about anything surprising before you go on.

## Step 4 — publish

`journeys_request_publish`, then give the operator the `reviewPath`. A signed-in person confirms in the dashboard; you cannot, and editing the draft afterwards voids the request.

## Step 5 — watch it until the launch gate is met

For the first two weeks, once a day:

1. `journeys_get_report`:
   - `integrity.duplicateSends` must be **0** — no step ever sent two emails.
   - `integrity.enrollmentsWithoutTrace` must be **0** — everyone who entered has a logged step.
   - `enrollments.exitReasons` should be mostly `reached_end` and `goal_reached`. Investigate `message_blocked`, `message_failed`, `proposal_dismissed`, `approval_timeout` or `loop_detected` with `skill://journeys/investigate-enrollment`.
   - `messages` shows how many emails were sent, are pending review or were dismissed per step. A growing `pending` count means reviews are falling behind.
2. `outreach_list_proposals` for journey emails waiting on review, if the operator wants a nudge.
3. Report goal conversion for the journey against the holdout once both groups have a few dozen people; before that the difference is noise.

The gate is met when both integrity numbers stayed at zero for two weeks of live traffic. Tell the operator, and propose any change as a new draft rather than editing what runs.
