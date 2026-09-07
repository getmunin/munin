---
'@getmunin/backend-core': patch
'@getmunin/agent-runtime': patch
'@getmunin/dashboard-pages': patch
---

Keep a voice turn that transcribed no speech, so a call transcript never loses the beat that explains the next answer.

A Threll call read as though the assistant answered a question nobody asked: it greeted the caller, then said "Hei Tronn, velkommen til Threll.ai" with no caller turn in between. Nothing was out of order — `voiceTurnIndex` ran 0, 2, 3, 4 and Slack mirrored exactly that. Turn 1 was missing, and Slack's collapsing of two adjacent same-speaker posts into one block made the remainder look shuffled.

Threll fixes a turn's position when the turn is *registered*, not when its text exists: a caller turn reserves its index and emits an interim, and the final follows when recognition resolves — with an empty string when it resolved to nothing, which is what happens when the caller is cut off mid-word. `ThrellAdapter` dropped every transcript event without text, so that turn vanished. It is now stored as a turn with an empty body and `metadata.voiceNoSpeech: true`, in its spoken position, in real time — no reconciliation pass and no late Slack post, because the empty final arrives on the same webhook stream as every other turn. An *agent* turn with no text is still dropped; only a caller turn holds a slot worth showing.

An empty body is the honest record, so the placeholder lives in the surfaces instead: Slack renders `_No speech transcribed_` (`chat.postMessage` rejects empty text), the dashboard drawer renders a muted italic line, the chat widget hides the turn from the visitor who lived through it, and the conversation-list preview skips empty bodies so a call ending on an unintelligible turn keeps its last real line. A silent turn is also not the visitor speaking last: `endUserSpokeLast` skips empty bodies, so the review queue stops offering "ask for a draft" on a turn that carries no question — which the runtime would refuse anyway. The conversation pane's own client-side computation of the same signal matches.

`toRuntimeHistory` filters bodies that are empty after trimming — an empty user turn is both useless to the model and rejected outright by providers that refuse empty content blocks — and the conversation handler declines to reply when the newest public turn is a silent one, so a straggling final that lands after `call.ended` cleared `voiceActive` can't provoke a chat reply after a voice call.
