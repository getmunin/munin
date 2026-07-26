---
title: 'Preview a draft entry'
description: Let editors view a draft CMS entry rendered by the customer frontend before publishing — configure the collection's previewUrl template, mint a signed preview link, and wire the frontend's draft-mode handler.
audiences: [admin]
---

# Preview a draft entry

The public delivery API only ever serves `status='published'` entries, so a draft is normally invisible to the frontend. Preview links close that gap: `cms_get_preview_link` mints a **signed, entry-scoped token valid for 1 hour**, and the single-entry delivery route accepts it as `?preview=<token>`, returning the entry regardless of status with `Cache-Control: no-store` (plus a `status` field so the frontend can render a draft banner). List and search routes never accept preview tokens — the preview unit is one entry.

Munin cannot render the customer's frontend itself; it delegates. The collection stores a `previewUrl` template pointing at the frontend's preview endpoint, and Munin substitutes the entry's coordinates plus the token into it.

## TL;DR

1. Once per collection: set `settings.previewUrl` via `cms_update_collection` (read-merge-write — see warning below).
2. Per preview: `cms_get_preview_link { id }` → open the returned `url` (or `deliveryUrl` for raw JSON when no template is set).
3. Once per frontend: a draft-mode route handler that accepts the token and re-fetches with `?preview=`.

## Step 1 — configure the collection's preview template

> **`settings` is replaced wholesale, not merged.** Always read the current settings first and send the merged object back, or you will wipe other keys such as `searchableFields`.

```jsonc
{ "name": "cms_get_collection", "arguments": { "idOrSlug": "blog-posts" } }
```

Then write back the existing settings plus the template:

```jsonc
{
  "name": "cms_update_collection",
  "arguments": {
    "idOrSlug": "blog-posts",
    "patch": {
      "settings": {
        // ...every key the collection already had, plus:
        "previewUrl": "https://www.example.com/api/preview?token={token}&slug={slug}&locale={locale}"
      }
    }
  }
}
```

Placeholders — each substituted value is URL-encoded:

| Placeholder | Substituted with |
|---|---|
| `{token}` | the signed preview token |
| `{slug}` | the entry's slug |
| `{locale}` | the entry's locale |
| `{collection}` | the collection's slug |

The substituted result must be a valid `http(s)` URL; minting fails with a 400 otherwise.

## Step 2 — mint a link

```jsonc
{ "name": "cms_get_preview_link", "arguments": { "id": "<entryId>" } }
```

Returns:

```jsonc
{
  "url": "https://www.example.com/api/preview?token=pv1....&slug=my-post&locale=en",
  "deliveryUrl": "https://api.example-tenant.com/v1/cms/org_x/blog-posts/my-post?locale=en&preview=pv1....",
  "token": "pv1....",
  "expiresAt": "2026-07-26T11:00:00.000Z"
}
```

- `url` is what a human opens — it is `null` when the collection has no `previewUrl` template.
- `deliveryUrl` is the raw delivery-API JSON for the draft; useful for verifying content without a frontend.
- Tokens expire after 1 hour, and a link stops resolving if the entry's slug changes — mint a fresh one in either case. Any status is previewable (draft, scheduled, archived, published).

## Step 3 — the frontend's side of the contract

The frontend needs one preview endpoint that flips it into draft mode and one change to its entry fetch. Next.js (app router) example:

```ts
// app/api/preview/route.ts
import { draftMode } from 'next/headers';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const token = params.get('token');
  const slug = params.get('slug');
  const locale = params.get('locale') ?? 'en';
  if (!token || !slug) return new Response('missing token or slug', { status: 400 });
  (await draftMode()).enable();
  (await cookies()).set('munin-preview-token', token, { httpOnly: true, secure: true, path: '/' });
  redirect(`/${locale}/blog/${slug}`);
}
```

```ts
// in the entry page's server-side fetch
const { isEnabled } = await draftMode();
const token = isEnabled ? (await cookies()).get('munin-preview-token')?.value : undefined;
const res = await fetch(
  `${API_URL}/v1/cms/${ORG_ID}/blog-posts/${slug}?locale=${locale}` +
    (token ? `&preview=${encodeURIComponent(token)}` : ''),
  token ? { cache: 'no-store' } : { next: { revalidate: 60 } },
);
```

Notes:

- The fetch stays **server-side** — the delivery API has no CORS headers by design (`skill://playbooks/frontend-integration`). Draft mode's own bypass cookie does not carry the Munin token, hence the extra cookie.
- Preview responses include `status`; render a visible "draft" banner when it isn't `published`.
- An expired or tampered token returns **403** (never a silent fallback to the published version); a slug mismatch returns **404**. Surface these rather than swallowing them — they mean "mint a new link".

## What NOT to do

- **Don't write `settings.previewUrl` without merging** the collection's existing settings (see Step 1).
- **Don't put the preview token in client-side fetches or localStorage.** It belongs in an httpOnly cookie and server-side requests only.
- **Don't try to preview a list page.** Tokens authorize exactly one entry; list and search routes ignore drafts unconditionally.

## Related

- `skill://cms/publish-entry` — the publish/schedule/rollback loop once the preview looks right.
- `skill://cms/localize-entry` — per-locale entries; each locale row is its own entry and needs its own preview link.
- `skill://playbooks/frontend-integration` — full frontend wiring (widget + analytics + CMS delivery).
