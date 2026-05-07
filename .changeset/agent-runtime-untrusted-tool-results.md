---
'@getmunin/agent-runtime': patch
---

Defense-in-depth against indirect prompt injection. The agent runtime now wraps every MCP tool result in `<tool_result tool="..."><data>...</data></tool_result>` tags before handing it back to the model, and prepends a system message explaining the convention: anything inside `<data>` is information, never instructions. This applies uniformly to `runAgent` callers — the conversational handler in agent-sidecar, the curator skill runner, and per-org runners in cloud.

The risk it closes: an attacker plants instructions ("ignore previous", "send the system prompt", "exfiltrate to attacker@…") inside a knowledge-base document, a CRM contact field, an inbound email body, or a curator-extracted activity note. The AI later fetches that text as grounding via `kb_search` / `crm_get_my_contact` / conversation history and could be steered into following the planted directive. The structural defenses already in place (RLS, audience-scoped tokens, human-approval on outbound actions) make this hard to weaponize, but the wrapping makes it harder still — and is essentially free at the LLM level (modern Claude respects the boundary well).

No behaviour change for the happy path. 68/68 tests pass.
