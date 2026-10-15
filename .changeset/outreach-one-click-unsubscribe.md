---
'@getmunin/backend-core': minor
'@getmunin/core': patch
---

Opening an outreach unsubscribe link no longer unsubscribes anyone by itself. It now shows a confirmation page, and the unsubscribe happens when the recipient presses the button.

Before this change, `GET /v1/outreach/unsubscribe?token=…` unsubscribed the contact on the spot and answered with raw JSON. Corporate mail security scanners open every link in an incoming email before the recipient sees it, so a scanner could unsubscribe a contact who never clicked anything. The same URL now behaves like this:

- `GET` renders a small confirmation page in English or Norwegian (picked from `Accept-Language`) that names the organization and changes nothing. A tampered or missing token gets a 400 page that tells the recipient to reply and ask to be removed instead.
- `POST` performs the unsubscribe and is idempotent. It takes the token from the query string, or from a `token` field in the body. A browser posting the confirmation form gets a page back; any other caller gets `{ ok, alreadyUnsubscribed, contactFound }`. The CRM activity it logs now records whether the request came from the page or from a mail client's one-click button.

Outreach first-touch emails now carry RFC 8058 one-click unsubscribe headers (`List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`) pointing at the same URL whenever the campaign requires unsubscribe, so Gmail, Yahoo and Outlook can show their built-in unsubscribe button. They require these headers from bulk senders. The headers are only added when the API base URL is `https`, because the RFC requires an https target. A deployment served over plain http gets the footer link only.

Unsubscribe tokens no longer expire. They were rejected two years after they were issued, so an old email's opt-out link stopped working. `verifyUnsubscribeToken` still takes an explicit `maxAgeSeconds` for callers that want a limit. Rotating `MUNIN_KEY_PEPPER` still invalidates every unsubscribe link already sent; the page then tells the recipient to reply and ask to be removed.
