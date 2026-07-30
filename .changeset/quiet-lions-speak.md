---
'@getmunin/backend-core': patch
---

Add a skill for drafting outbound calls

`skill://outreach/draft-initial-call` covers the voice-campaign pass, which had no skill of its own — an agent had to infer from the email skill that `draftBody` on a voice campaign is what a text-to-speech agent says out loud, not a message that gets delivered.

It says what only a spoken channel needs said: write speech rather than prose, no markdown or emoji (read aloud or mangled), no URLs or reference codes (nobody can click on a phone call), identify the caller in the first sentence, give the voice agent a goal and boundaries rather than a script, and tell it what to do when the person is busy or asks whether it is a human. It also sets a higher bar for who is worth calling at all — matching a segment filter is a reason to email, not to phone — and states that approval is dashboard-only, so filing the proposal is where the agent stops.

Cross-links the three first-touch skills to each other and lists all of them in `review-proposals`, which named only the email ones.
