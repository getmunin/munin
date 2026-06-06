# @getmunin/analytics-tracker

## 4.40.2

### Patch Changes

- 38e00cd: Tidy up the changesets configuration to cover every workspace package:
  - Add `@getmunin/analytics-tracker` to the `fixed` group so it bumps in lockstep with the rest of the publishable `@getmunin/*` suite. The package was introduced at `4.33.0` and never re-versioned, leaving downstream consumers unable to pin `^4.x` against the same range as `@getmunin/backend-core`. `apps/analytics-tracker/package.json` is manually aligned to `4.40.1` so this release moves the group together.
  - Add `@getmunin/widget-voice` to the `ignore` list. It's `private: true` and already excluded from publishing, but every other private package in the workspace is explicitly ignored — adding it here keeps the config consistent and prevents accidental version-bump noise.
