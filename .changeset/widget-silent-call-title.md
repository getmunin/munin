---
"@getmunin/backend-core": patch
---

Fix widget conversation list showing a blank title instead of "Conversation" for a Threll voice call where the caller said nothing. The silent-turn placeholder message is now excluded from the title/preview fallback, matching how it's already hidden from the visitor-facing message list.
