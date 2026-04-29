---
'@getmunin/core': minor
'@getmunin/db': minor
'@getmunin/types': minor
'@getmunin/sdk': minor
'@getmunin/mcp-toolkit': minor
'@getmunin/bootstrap': minor
'@getmunin/ui': minor
'@getmunin/dashboard-pages': minor
'@getmunin/backend-core': minor
---

Add credential-resolver extension point to AuthGuard.

`AuthGuard` now accepts an optional injected `AdditionalCredentialResolver[]`
via the `ADDITIONAL_CREDENTIAL_RESOLVERS` token. When OSS's `resolveApiKey`
returns null, each additional resolver gets a shot at the raw key. Cloud
(`@munin-cloud/partner`) plugs in `PartnerCredentialResolver` here to
recognize `mn_part_*` keys without touching OSS code.

`looksLikeApiKey` regex broadened from `mn_(admin|dlg)_*` to `mn_[a-z]+_*`
so non-OSS kinds (like `mn_part_*`) reach the resolver chain.
