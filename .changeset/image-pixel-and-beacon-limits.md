---
"@getmunin/backend-core": patch
"@getmunin/dashboard-pages": patch
---

Cap how many pixels an uploaded image may decode to, and how much a public analytics beacon may store.

A small, highly compressed PNG can decode to hundreds of megapixels, so an anonymous widget upload or an inbound email could make the server allocate gigabytes. Images over 8192×8192 pixels (about 67 megapixels, comfortably above a 50-megapixel phone photo) are now handled without being decoded:

- Widget and dashboard attachment uploads are rejected with `conv_attachment_too_many_pixels`, translated in the dashboard. An uploaded object is purged, and `storeBytes` refuses before writing.
- Inbound email images are dropped with the reason `too_many_pixels`.
- CMS assets keep the upload but get no variants; the variant worker settles them as undecodable.
- Social media transcoding reports the image as undecodable.

Dimensions are read from the image header without decoding it, and every decoding `sharp` call also sets `limitInputPixels` as a backstop.

Analytics beacons (`POST /v1/a/t` and `POST /v1/a/v`) used to accept up to 4 MB of `metadata` per event through the public tracker key. Metadata that serializes to more than 4 KB is now dropped and the view is still recorded, the same way over-long fields are truncated rather than losing the event. Request bodies under `/v1/a` are capped at 64 KB, which is what `navigator.sendBeacon` can send anyway; larger bodies get a 413.
