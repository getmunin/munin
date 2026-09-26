---
'@getmunin/types': minor
'@getmunin/dashboard-pages': minor
'@getmunin/backend-core': patch
---

Let the person authorizing an MCP connection choose whether it sees raw personal data. `pii:raw` joins the advertised OAuth scopes, and the consent screen gains a personal-data panel: by default the connection is pseudonymized and the grant is narrowed to leave `pii:raw` out, and only ticking "Share personal data as stored" grants it, with a warning that sets it visibly apart. The raw scope never renders as an ordinary module card.

Minting an API key now offers "Pseudonymize personal data", ticked by default, which mints the key with every scope except `pii:raw`. The key list shows which keys see raw personal data.
