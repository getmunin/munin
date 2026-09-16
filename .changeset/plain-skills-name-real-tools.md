---
'@getmunin/backend-core': patch
---

Make every skill name tools that exist, and keep it that way.

A skill is the agent-facing UI for a feature, so a tool name in one is a promise
an agent will try to keep. Four skills had drifted:

- `crm/deduplicate-contacts` still said there was no merge tool and walked
  through a manual reconcile — copy the fields across, tag the loser, accept
  that activities stay behind. `crm_propose_merge` and `crm_apply_merge_proposal`
  have done that atomically for a while, and the manual pattern now produces a
  worse end state than the tools do. Rewritten around the proposal flow, with
  `clean-contact-data` keeping the scheduled population sweep.
- The `customer-acquisition` and `publish-and-distribute` playbooks opened
  conversations with `conv_start_conversation`. No such tool exists — and a test
  asserts it never appears — so cold outbound now routes through outreach, where
  an approved proposal is what creates the conversation and sends.
- `conv/setup-email-channel` offered `conv_change_agent_mode` as the
  per-conversation override. Per-conversation posture is dashboard-only; an agent
  changes a channel default or a topic override.
- `connectors/connect-external-system` never mentioned OAuth, while
  `seo/improve-search-performance` pointed at it for the redirect Google Search
  Console needs. It now documents the authorize-url flow, why a connection stays
  `pending` until the grant lands, and the sensitive-scope verification caveat.

`scripts/check-skill-tool-refs.mjs` runs in pre-commit and CI. A prefixed
snake_case name in a skill must match an `@McpTool`, or at least exist somewhere
in non-test source — which is what separates a renamed tool from an error code or
a table name. Names in a `"name": "…"` call position get no such latitude. Both
allow-lists are keyed by reason, so excusing a name is a visible decision; the one
entry that needs it is `crm_close_deal`, which a skill names precisely to say it
does not exist.

Also swaps the signature-stripping fixtures onto obvious placeholders — the
persona in `conv/strip-email-signature` and its tests read like a real person.
