---
'@getmunin/backend-core': patch
---

**Security**: encrypt social-provider tokens at rest (`accounts.accessToken`,
`refreshToken`, `idToken`).

Audit of finding #5 (sensitive auth material plaintext at rest):

| Column                       | Status                                        |
|------------------------------|-----------------------------------------------|
| `accounts.password`          | ✅ Already hashed (scrypt) by BetterAuth.     |
| `accounts.accessToken/refreshToken/idToken` | ❌ **Plaintext by default.** Fixed. |
| `jwks.privateKey`            | ✅ Encrypted (BetterAuth's jwt plugin wraps with `symmetricEncrypt` unless `disablePrivateKeyEncryption` is set). |
| `oauthClient.clientSecret`   | ✅ Hashed (SHA-256) by `@better-auth/oauth-provider`'s `storeClientSecret` (default `'hashed'`). |
| `oauthRefreshToken.token`    | ✅ Hashed (SHA-256) by `storeToken`.          |
| `oauthAccessToken.token`     | ✅ Hashed (SHA-256). Matches our `credentials.ts` lookup hash. |

Only `accounts.*Token` columns were actually plaintext. Set
`account.encryptOAuthTokens: true` in the BetterAuth factory — provider tokens
are now `symmetricEncrypt`-wrapped with the existing `secret`. Decryption
happens transparently on read.

The remaining columns the auditor flagged were already protected at the
application layer despite their `text` shape in the Drizzle schema.

**Existing rows**: any social-provider tokens already in `accounts` from
previous logins remain plaintext until that row is rewritten. BetterAuth's
`decryptOAuthToken` helper detects "looks-encrypted" tokens and only attempts
decryption when the format matches, so existing plaintext tokens keep working
on read. New tokens (refresh on next sign-in) land encrypted.
