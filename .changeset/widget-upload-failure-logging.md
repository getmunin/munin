---
'@getmunin/chat-widget': patch
'@getmunin/backend-core': patch
---

The chat widget now logs why an image upload failed. A blocked or refused upload to storage used to surface only as "network error" with nothing in the console; it now logs `[munin-widget] attachment upload failed:` with the storage host, the browser's reason or the HTTP status, and, for a request that never completes, a reminder that the bucket must allow uploads from the embedding site's origin. The presigned query string is kept out of the message.

The widget setup skill and `.env.example` now say that S3-compatible storage needs a bucket CORS rule allowing POST and PUT from any origin. Browsers upload straight to the bucket, and the widget does so from every site that embeds it, so an allow-list containing only the dashboard origin breaks visitor image uploads.
