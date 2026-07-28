---
'@getmunin/backend-core': patch
---

CMS: never keep an image variant that is heavier than its master.

The variant ladder assumed recompressing to WebP q80 always beats the original. For an already-efficiently-compressed photographic JPEG at full width it does not — WebP loses that contest. On a real asset a 199,523-byte JPEG master produced a 214,250-byte "derivative", and because delivery resolves inline `asset://` to the widest variant, the delivery path served 7% *more* bytes than the master it was supposed to improve on.

- Any rendition whose encoded bytes are not smaller than the master is discarded rather than stored. `widestVariantUrl` then falls back to the next-widest rendition, or to the master when none qualify, so the invariant is now "a variant is only ever offered if it is genuinely lighter".
- Renditions dropped by this rule are also deleted from storage, so re-deriving an asset that previously produced an oversized variant reclaims that object instead of orphaning it.
- `VARIANT_LADDER_VERSION` goes to 2, so the CMS worker's reconciliation pass re-derives every existing asset under the new rule. No backfill or manual repair.

The regression escaped its own test: the suite already asserted "every variant is lighter than the master", but built the fixture from `sharp({create})` with a flat solid colour, which compresses so trivially that the assertion could not fail. The fixture is now a noisy JPEG master, which reproduces the failure against the old code, and there is explicit coverage for dropping the oversized rendition and for reclaiming a superseded object.
