---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
---

CMS asset uploads now accept an explicit allow-list of file types instead of rejecting only SVG. Raster images (png, jpeg, gif, webp, avif, heic/heif, bmp, tiff, ico), video (mp4, webm, mov, ogv), audio (mp3, m4a, aac, wav, ogg/opus, weba, flac) and PDF are accepted; everything else — HTML, XHTML, XML, SVG, scripts, plain text and unknown types — is refused with `cms_asset_type_not_allowed` on every upload route (presigned upload, base64, from-URL and import). Assets are served from a public URL with the declared content type, so a type a browser renders as an active document must never be stored there.

The declared MIME type is normalized (lowercased, parameters stripped) before it is checked and stored, and a filename extension that contradicts it is refused with the same code. A name without an extension takes the extension of its MIME type. The dashboard shows a translated message for the new code, and the upload tool descriptions and the asset skills list the accepted types. Assets stored before this change are not touched.
