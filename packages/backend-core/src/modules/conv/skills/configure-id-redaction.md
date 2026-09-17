---
title: 'Conv: Configure national ID redaction'
description: Decide what Munin keeps when customers send national identity numbers, and clean up messages stored before the policy was set.
audiences: [admin]
---

# Configure national ID redaction

Use this when an operator asks you to hide, scrub, or stop storing national identity numbers that customers send in — Norwegian fødselsnummer, Swedish personnummer, Danish CPR-numre.

## TL;DR

1. `conv_get_redaction_policy` to see where the org stands.
2. Ask which identifier types they actually receive, and whether they need the number at all.
3. `conv_configure_redaction` with those detectors and a policy.
4. If they want history cleaned too, call `conv_redact_existing_messages` repeatedly until `done` is true.

## What detection does on its own

Munin looks for all three identifier types on every inbound message regardless of the policy, and records what it found on the message as `detectedNationalIds` — kinds and counts, never the digits. The first time one turns up in an org it also opens a `data_protection` alert.

So an org that has never configured anything still learns that it is receiving these numbers. That is deliberate: nothing is rewritten until someone chooses to, because rewriting a customer's message is irreversible.

This also means detection reports types the org has **not** enabled. A Norwegian tenant seeing `dk_cpr` in `detectedNationalIds` is being told something useful — offer to add that detector.

## Step 1 — read the current policy

```jsonc
// conv_get_redaction_policy
{}
```

Returns the enabled `detectors`, the `policy`, the confidence floor, and `availableDetectors`.

## Step 2 — choose a policy with the operator

Three questions, in this order.

**Which identifier types?** Only enable what they actually receive. `no_fnr`, `se_pnr`, `dk_cpr`.

**What should happen to a match?**

| Policy | Effect | Choose it when |
|---|---|---|
| `off` | Stored unchanged. Detection still reports. | They have a legal basis and a real need for the number. |
| `mask` | Keeps the birth date, hides the rest (`010190*****`). | Staff need to match a person to a case, but not to hold the identifier. |
| `remove` | Replaced by a marker naming what was removed. | They should not be holding it at all. This is the usual answer for a support inbox. |

**How certain must a match be?** `high` (the default) requires a check digit or a separator, and leaves order numbers and account numbers alone. `medium` also catches bare digit runs.

Recommend `high` unless they specifically report missed numbers. The one case where `medium` is genuinely worth discussing is Danish CPR: Denmark dropped its check digit in 2007, so a bare ten-digit CPR is indistinguishable from any other ten-digit reference, and only the hyphenated form is caught at `high`.

## Step 3 — set it

```jsonc
// conv_configure_redaction
{
  "detectors": ["no_fnr"],
  "policy": "remove",
  "minConfidence": "high"
}
```

A non-`off` policy with an empty `detectors` list is rejected — it would silently do nothing.

This applies to messages that arrive **after** the call. Every stored copy is covered: the plain body, the HTML body, the conversation subject, and the quoted history and signature captured in message metadata.

## Step 4 — clean up history, if they want it

`conv_configure_redaction` does not touch existing messages. To rewrite what is already stored:

```jsonc
// conv_redact_existing_messages
{ "limit": 200 }
```

Call it again with the returned `nextCursor` until `done` is true. It only rewrites messages that actually contain a match, and emits `conversation.message.body_revised` so a mirrored copy in Slack is re-synced.

Tell the operator plainly before you start: this cannot be undone, and there is no copy of the original.

## What this does not cover

Say these out loud rather than letting an operator assume otherwise.

- **Attachments.** A number inside a PDF or an image is not detected or redacted.
- **Copies already sent.** Replies already emailed, Slack messages already posted, and webhook deliveries already made cannot be recalled.
- **What staff type.** Redaction runs on inbound customer messages, not on replies your own team writes.

Separately, and regardless of the policy: national identity numbers are stripped from anything sent to a language model, so an agent never sees the digits even when the org stores them in full.

## Related

- `skill://conv/setup-email-channel` — the channel these messages usually arrive on.
- `skill://conv/strip-email-signature` — the other pass that rewrites a stored inbound body.
