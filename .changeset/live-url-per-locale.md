---
'@getmunin/backend-core': minor
---

`settings.liveUrl` now accepts a per-locale map, not just one template.

`{locale}` substitutes the locale code as Munin stores it — `nb-NO`, not `no` — so a site that spells its paths `/no/blog/…` had no way to express its live URL and every publish announced without a link. A collection can now map locale code to template, with an optional `default` for the rest:

```jsonc
{
  "liveUrl": {
    "default": "https://www.example.com/en/blog/{slug}",
    "nb-NO": "https://www.example.com/no/blog/{slug}",
    "sv-SE": "https://www.example.com/sv/blog/{slug}"
  }
}
```

Keys match case-insensitively. A locale named by neither the map nor `default` publishes without a link, which is how a locale that is not on the site yet stays out of the announcement. A plain string still means one template for every locale, so nothing configured today changes.
