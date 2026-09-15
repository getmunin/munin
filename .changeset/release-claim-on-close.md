---
'@getmunin/backend-core': patch
---

Release a human claim on every close, not just the dashboard one.

Settling a conversation (`closed` or `spam`) already cleared the runner lease inside
`ConvService.changeStatus`, but the human claim was released one level up, in the `/v1`
status controller. So closing from the dashboard released the claim and every other path
did not: the `conv_change_status` MCP tool, the `autoCloseInactive` sweeper, Slack's Close
button, and the Vapi/Threll adapters closing on call end all left the claim row behind for
the rest of its 30-minute TTL.

The visible symptoms were a conversation still showing as claimed in the web UI after the
holder closed it from Slack, and — because inbound messages reopen a closed conversation —
the AI agent being blocked by `HandoverActiveError` if the customer replied inside that
window, on a conversation the human had already finished with.

The release now lives in the service next to the runner-lease clear, and the controller is
a thin wrapper again.
