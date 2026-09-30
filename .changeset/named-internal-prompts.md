---
'@getmunin/agent-runtime': patch
---

Give every prompt behind translation, language detection and the turn audit a name, and pin each one in a plain-text snapshot under `src/__prompts__/`. A change to what these internal calls tell the model now shows up in review as a readable text diff, and a test fails until the snapshot is updated with it. The prompts sent are unchanged.
