---
'@getmunin/backend-core': minor
---

Outreach calls work on any registered voice vendor, not only Vapi

`loadOutreachChannel` accepted `voice:vapi` and nothing else, so a campaign could not run on a Threll channel even though Threll has shipped an adapter, admin service and dashboard support for as long as Vapi has. The restriction was an accident of the voice path being written against one vendor: `approveInitialVoice` called `VapiClientService` directly, read config with Vapi's parser, and hard-coded `vapiCallId` as the key linking a call back to its conversation.

Voice outreach now goes through a small `OutreachVoiceCaller` seam — vendor name, the metadata key its conversations are keyed by, and one `placeOutreachCall` method — registered per vendor and resolved by `channel.vendor`. Adding a third vendor is a class implementing that interface and a line in the module; nothing in `OutreachService` needs to know it exists. A voice channel whose vendor has no registered caller is refused at campaign-create time, naming the vendors that do work, rather than failing at approval.

Each vendor keeps the linkage its own webhook expects: Vapi carries the draft and the outreach ids in `assistantOverrides.metadata` and keys conversations on `vapiCallId`, Threll passes the draft as call `context` and keys on `threllCallId`. Both partial unique indexes already existed (0026 and 0040), so no migration was needed.
