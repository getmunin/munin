---
'@getmunin/backend-core': minor
'@getmunin/types': minor
'@getmunin/dashboard-pages': minor
---

Journeys gain agent decide steps. An `agent` node with `mode: "decide"` asks a model one question about a person — "is this trial user likely to buy?" — and continues on exactly one of its declared edges. The model sees only the inputs the node lists (contact, company, latest reply, thread, recent product events, journey context), with national ID numbers masked and contact email reduced to its domain. The decision runs as a fast-tier curator job (`skill://journeys/decide-step`) that can only call `journeys_submit_decision` for its own step; the reason, confidence, job status and token use appear in the step trace.

Every agent node declares a fallback edge, taken when no valid decision arrives within its timeout (ten minutes by default) — including when no model is configured — so nobody is left waiting. Simulations follow the fallback and say so in the publish dialog.
