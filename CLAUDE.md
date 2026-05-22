# Skill and task URI naming

Conventions for `skill://*` markdown under `packages/backend-core/src/modules/*/skills/` and `task://*` URIs in `packages/types/src/job-catalog.ts`.

## Slug

- **verb-object[-qualifier]**, lowercase, hyphen-separated.
- Imperative: `setup-email-channel`, `import-and-score-leads`, `publish-entry`, `escalate-to-human`.
- No vague nouns: `hygiene`, `curation`, `workflow`, `draft`, `onboarding` (use `clean-contact-data`, `review-content`, `publish-entry`, `draft-initial-email`, `create-first-space`).
- No module name in the slug — the path already namespaces it (`kb/curation` was redundant; `kb/review-content` is enough).
- Filename = `<slug>.md` and **must match** the URI segment. The loader derives the URI from the path: `<module>/skills/<slug>.md` → `skill://<module>/<slug>`.

## Title (frontmatter `title:`)

- Plain-English, task-shaped: "Set up an email channel", "Import and score leads", "Publish a CMS entry".
- Don't repeat the product name (`Munin`, `CMS`, `KB`, `CRM`) unless it disambiguates against a generic word ("Set up a chat widget" is fine; "CMS entry publish workflow" is not).
- Sentence-case, no trailing period.
- First H1 inside the body should match the title.

## Exception — `playbooks/*`

Playbooks are intentionally noun-led ("Customer acquisition", "Support desk launch", "Publish and distribute") — they name a packaged workflow rather than a single action. Keep that style.

## Renaming a slug

Code consumers of skill URIs live in:

- `packages/types/src/job-catalog.ts` — `KNOWN_SKILL_URIS`, `TIER_BY_URI`, `TOOL_PREFIXES_BY_URI`, and `WEB_SCRAPE_SITE_TASK_URI`.
- `packages/backend-core/src/modules/curator/curator-scheduler.service.ts` — scheduled `jobUri` constants.
- `packages/backend-core/src/modules/conv/conv.service.ts` — dispatch sites for draft / curation / extraction jobs.
- `packages/backend-core/src/modules/{kb,crm}/*.tools.ts` — `skill://...` references inside MCP tool descriptions.
- `packages/dashboard-pages/src/pages/ai-settings.tsx` and `packages/dashboard-pages/src/components/agent-config/website-import-card.tsx` — UI references.
- `packages/agent-runtime/src/*.test.ts` — fixtures.
- Cross-references in other `skills/*.md` files (`skill://<module>/<old-slug>` body links).

Persisted `curator_jobs.job_uri` rows need a `UPDATE … WHERE job_uri = '<old>'` migration alongside.

After renaming, regenerate fixtures with `pnpm -F @getmunin/backend-core docs:generate`.
