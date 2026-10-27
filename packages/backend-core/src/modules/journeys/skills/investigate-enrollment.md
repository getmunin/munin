---
title: Investigate a journey enrollment
description: Explain why one person is where they are in a journey — or why they never entered or left early — from the step trace, and decide whether to wait, fix the journey, or remove them. Read-only apart from an optional, operator-approved eject.
audiences: [admin]
---

# Investigate a journey enrollment

Use this when someone asks "why did Kari get this email", "why is Ola stuck", or "why did nobody from the webinar enter the journey".

## Find the run

1. `journeys_list` to find the journey, then `journeys_list_enrollments` with `contactId` (find the contact with `crm_search_contacts`). Several rows mean several runs: the journey allows re-entry after a run ends.
2. `journeys_get_trace` on the enrollment.

## Read the trace

Every node visit is one step, in order. Each step has the node, the edge taken and a `reason`:

- **branch** steps say which rule matched (`rule 2 matched`) or `no rule matched`. Rules are checked in order, so an early broad rule hides later ones.
- **split** steps record the bucket (0–99) the person hashed into; the same person always lands in the same path.
- **wait** and **wait_for** steps with status `waiting` are where the person is now. `openWaits` shows when a timer fires or which event the run is waiting for and when it times out.
- **action** steps show the result, or `failed: …` with the error. A step with status `retrying` will try again; permanent errors (unknown contact, missing webhook) do not retry and follow the node's `onFail`.
- The enrollment's `exitReason` says how the run ended: `reached_end`, `goal_reached`, `matched_exit`, `idle_timeout`, `loop_detected`, `wait_timeout`, `action_failed`, `holdout`, `ejected`, or `node_missing`.

`context.trigger` holds the event that started the run; `context.lastEvent` holds the last event a `wait_for` received.

## Someone never entered

Check, in this order:

1. The journey is `live` (`journeys_get`). Draft and paused journeys enroll nobody.
2. The trigger: for an event trigger, the event name must match exactly (`analytics_list_product_event_names`), and events older than `entry.lateEventWindowHours` are ignored.
3. The entry segment: the contact must match it and have a recorded lawful basis, must not be unsubscribed, and must not be marked do-not-contact.
4. Re-entry: with `once` a person enters at most once; with `once_at_a_time` not while a run is open.
5. The holdout: an enrollment with `holdout: true` entered on purpose and was held back to measure lift.

## What to do

- A journey that behaves as designed but not as intended needs a new draft (`skill://journeys/build-journey`); people already in it finish on their version.
- To take one person out, `journeys_eject` — but only when the operator asks you to.
