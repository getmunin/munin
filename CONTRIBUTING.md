# Contributing to Munin

Thanks for your interest. Munin is evolving quickly — APIs, schema, and conventions are still settling, so expect some churn.

## Local setup

Prerequisites: Node 24 LTS (use `.nvmrc`), pnpm 10, Docker.

```bash
nvm use
pnpm install
docker compose up -d postgres
pnpm --filter @getmunin/db migrate
pnpm dev
```

## Running tests

```bash
pnpm test               # all packages
pnpm --filter <pkg> test  # one package
```

## Conventional commits

We use [Conventional Commits](https://www.conventionalcommits.org/). Example: `feat(kb): add hybrid search`. Enforced by commitlint.

## Pull requests

- Branch from `main`, named `<type>/<kebab-summary>` (`type` = a Conventional Commit type like `feat|fix|chore|docs|refactor|test|ci`) — e.g. `feat/hybrid-search`. A `pre-push` hook enforces this.
- One logical change per PR
- Keep PRs under ~400 lines where possible
- Include a `Test plan` section in the description
- CI must pass (lint, typecheck, test, build)

## Reporting issues

Use the issue templates. For security issues see [SECURITY.md](./SECURITY.md).

## Code of conduct

See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
