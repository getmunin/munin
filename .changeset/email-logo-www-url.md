---
'@getmunin/emails': patch
---

Point the default email logo URL at `https://www.getmunin.com/email-assets/raven-flying.png` (was the apex `getmunin.com`). The apex's HTTP→HTTPS redirect on the LB ACL already forwarded to `www.`, but going directly avoids the extra hop and the brief render gap some mail clients show when an image URL redirects. `MUNIN_EMAIL_LOGO_URL` still overrides the default — set it for self-hosters who don't own getmunin.com.
