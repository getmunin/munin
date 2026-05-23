# @getmunin/docs-pages

## 1.0.10

### Patch Changes

- @getmunin/backend-core@4.9.0

## 1.0.9

### Patch Changes

- Updated dependencies [7c9a3d3]
- Updated dependencies [0a0e2a1]
  - @getmunin/backend-core@4.8.0

## 1.0.8

### Patch Changes

- Updated dependencies [8c79922]
  - @getmunin/backend-core@4.7.1

## 1.0.7

### Patch Changes

- Updated dependencies [5108510]
  - @getmunin/backend-core@4.7.0

## 1.0.6

### Patch Changes

- Updated dependencies [04edb03]
- Updated dependencies [afcf3a1]
  - @getmunin/backend-core@4.6.1

## 1.0.5

### Patch Changes

- Updated dependencies [b770bce]
  - @getmunin/backend-core@4.6.0

## 1.0.4

### Patch Changes

- Updated dependencies [8d6b8b9]
  - @getmunin/backend-core@4.5.1

## 1.0.3

### Patch Changes

- Updated dependencies [9367ac8]
  - @getmunin/backend-core@4.5.0

## 1.0.2

### Patch Changes

- @getmunin/backend-core@4.4.1

## 1.0.1

### Patch Changes

- @getmunin/backend-core@4.4.0

## 1.0.0

### Major Changes

- 21a8189: Introduce `@getmunin/docs-pages`: lifts the developer-portal routes (`/docs`, `/docs/rest`, `/docs/mcp`, `/docs/skills`, `/docs/guides`) out of `apps/web` into a shared package so munin-cloud can mount the same docs under its own auth/header chrome. The OSS `apps/web/app/[locale]/docs/*` routes are now thin one-liner shells that re-export from the package.

  `@getmunin/backend-core` now publishes the OpenAPI spec and docs fixtures (mcp-tools.json, skills.json) via package subpath exports (`@getmunin/backend-core/openapi.json`, `@getmunin/backend-core/docs-fixtures/*`) so downstream consumers can read them at build time.

  Dashboard: removes the CONV pill from the Last conversations rows — the conversation rows in that section are conversations by definition; the pill was redundant.

### Patch Changes

- Updated dependencies [21a8189]
- Updated dependencies [21a8189]
  - @getmunin/backend-core@4.3.0
