---
"@getmunin/backend-core": patch
---

Voice calls now read the per-channel descriptor (`agent-runtime/channel-<channel id>`) that text conversations already used. Threll and Vapi phone calls get a `[Channel]` block naming the voice channel, followed by its descriptor. A call started from the chat widget gets the widget channel's descriptor instead of the voice channel's, so one shared voice channel can take calls from several sites and each call still knows which site it is answering for. Before this, an organization running several sites from one Munin org could pin each voice channel's knowledge and store connections, but the voice agent was never told which site the call was for.
