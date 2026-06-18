---
"@getmunin/backend-core": patch
---

fix(realtime): fan out typing indicators across backend replicas

Typing indicators (the widget "writing" bubble) were delivered only within a single Node process, so with multiple backend replicas they were lost in production: the AI agent runner (a per-org singleton) and a human operator's dashboard connection usually live on a different replica than the one holding the visitor's WebSocket.

Typing now travels over a Postgres `NOTIFY agent_typing` channel — the same cross-replica backplane already used for messages. The originating replica still delivers locally (preserving sender-exclusion and the auto-clear timer); a per-instance id on the payload prevents the origin from double-delivering its own echo, while every other replica fans the event out to its own connected clients. Covers all three directions: agent → visitor, human operator → visitor, and visitor → operator.
