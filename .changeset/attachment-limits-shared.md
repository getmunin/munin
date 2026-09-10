---
'@getmunin/types': minor
'@getmunin/backend-core': patch
'@getmunin/chat-widget': patch
'@getmunin/dashboard-pages': patch
---

Share one set of attachment limits between the server and both clients, and validate uploads in the
dashboard composer before they leave the browser.

The allowlist, the 10 MB cap and the per-message maximum existed in two places — the server's
`conv-attachments.constants.ts` and the widget's `upload.ts` — and in neither for the dashboard,
which reused `lib/upload-image.ts`, the CMS asset helper (SVG allowed, no size cap). A wrong file
type was silently dropped, an oversized one round-tripped to the server and came back as a bare
"Upload failed", and nothing enforced the per-message cap client-side. An SVG was the sharp edge: it
passed the `image/*` filter, uploaded untouched, then failed the server allowlist with no hint why.

`@getmunin/types` now owns `CONV_ATTACHMENT_*` plus `attachmentRejectionFor`, and all three callers
read from it. The dashboard checks type, size and count up front and reports each rejection through
the conversation pane's existing `role="alert"` banner rather than a second, quieter channel — so an
attachment failure now reads like every other action failure in that pane. Attachment deletion also
stops reporting itself as "Send failed": `QueueActionType` gains `attach`.

Icons in the attachment UI stop being characters. The removed-attachment chip swaps its 🚫 emoji for
lucide's `ImageOff`, and both remove buttons swap `✕` for lucide's `X`, so all three render in the
pane's own ink and follow dark mode instead of leaning on the platform emoji and text fonts. The
widget inlines the same `X` geometry — it draws into a shadow root and cannot import from
lucide-react — so its chip control stays visually matched to the dashboard's.
