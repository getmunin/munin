# README asset capture

Regenerates the images in `.github/assets/` from the real UI, so a screenshot in the
README is never a hand-cropped memory of a build from three months ago.

Two rigs, because the two surfaces need different things:

| Asset | Rig | Needs a backend? |
|---|---|---|
| `widget-demo.webp` | `widget.capture.ts` | no — the widget bundle runs against mocked `/v1/widget/*` and a mocked realtime socket |
| `dashboard.png`, `dashboard-overview.png` | `dashboard.capture.ts` | yes — a real backend, a scratch database, and a seeded org |

Everything a customer could be identified by is a placeholder: `Ola Nordmann`,
`Acme Kitchen`, `example.com`, `shop.acme.test`. Keep it that way — these files end up
in a public README, and `scripts/check-fixture-pii.mjs` gates them.

## The widget animation

```sh
pnpm turbo run build --filter=@getmunin/chat-widget...
pnpm -F @getmunin/web exec playwright test -c capture/playwright.capture.ts --project=widget
node apps/web/capture/to-webp.ts
```

The spec serves a fake shop page, loads the **built** widget bundle from
`apps/chat-widget/dist`, and answers every `/v1/widget/*` call from an in-memory
transcript. Agent replies are pushed the way the real server pushes them — a
`{"type":"event"}` frame over the mocked realtime socket, which makes the widget
backfill — so the typing indicator, the message timing and the AI-to-human handover
are the widget's own behaviour, not a re-creation of it.

Edit `transcript.ts` to change what is said. Playwright records the whole run as
webm; `to-webp.ts` crops it to the panel's real bounding box (written to
`.artifacts/widget-crop.json` by the spec, so a resized panel needs no new magic
numbers) and assembles an animated webp with `img2webp`.

Tunables, all env vars on `to-webp.ts`: `MUNIN_CAPTURE_FPS` (12),
`MUNIN_CAPTURE_WIDTH` (420), `MUNIN_CAPTURE_QUALITY` (68), `MUNIN_CAPTURE_START`,
`MUNIN_CAPTURE_DURATION`, `MUNIN_CAPTURE_CROP`. Requires `ffmpeg` and `img2webp`
(`brew install ffmpeg webp`). Note that Homebrew's ffmpeg ships without a webp
encoder, which is why the frames go through `img2webp` rather than straight out of
ffmpeg.

## The console screenshots

These need a stack. Use a scratch database — never your dev database, because the
seed truncates conversation tables and the screenshots are published.

```sh
docker exec -i docker-postgres-1 psql -U munin -d postgres \
  -c "CREATE DATABASE munin_capture OWNER munin;"

export DATABASE_URL=postgres://munin_app:munin_app@localhost:5432/munin_capture
export MUNIN_MIGRATE_URL=postgres://munin:munin@localhost:5432/munin_capture
export MUNIN_AUTH_SECRET=capture-only-secret-capture-only-secret-0001
export MUNIN_KEY_PEPPER=capture-only-pepper-capture-only-pepper-0001
export MUNIN_ENCRYPTION_KEY=capture-only-enckey-capture-only-enckey-001
export MUNIN_CORS_ORIGINS=http://localhost:3020
export MUNIN_AUTH_TRUSTED_ORIGINS=http://localhost:3020,http://localhost:3001
export MUNIN_WEB_URL=http://localhost:3020
export MUNIN_SSRF_ALLOW_PRIVATE=1
export MUNIN_BUILTIN_AGENT=0
export MUNIN_INBOUND_POLL_WORKER_DISABLED=1

pnpm -F @getmunin/db db:migrate
pnpm -F @getmunin/backend migrate          # agent_config and agent_health singletons
pnpm -F @getmunin/backend dev &

NEXT_PUBLIC_API_URL=http://localhost:3001 NEXT_PUBLIC_AUTH_URL=http://localhost:3001 \
  pnpm -F @getmunin/web exec next dev --port 3020 &

node apps/web/capture/seed.ts
MUNIN_CAPTURE_BASE_URL=http://localhost:3020 \
  pnpm -F @getmunin/web exec playwright test -c capture/playwright.capture.ts --project=dashboard
```

The seed is not idempotent — every run opens new widget sessions, so a second run gives
you each conversation twice. It refuses to run against an org that already has
conversations; reset before re-seeding:

```sh
docker exec -i docker-postgres-1 psql -U munin -d munin_capture \
  -c "TRUNCATE conv_conversations, conv_messages, conv_channels, end_users CASCADE;"
```

Two settings above are load-bearing. `MUNIN_BUILTIN_AGENT=0` stops the in-process
runner from answering the seeded conversations — with no real LLM provider it fails,
posts "I'm having trouble responding right now" into the thread and leaves handover
notes all over the screenshot. `MUNIN_SSRF_ALLOW_PRIVATE=1` lets the seed point
`providerBaseUrl` at a throwaway local stub: `/v1/agent-config` validates the key
against the provider's `/models` before saving, and setup stays incomplete (so the
dashboard redirects to `/setup`) until a provider is configured.

`seed.ts` builds the org the way a real one is built rather than writing rows:
sign-up, org rename, agent config, `*_import` for the knowledge base and CRM, then
conversations through the **widget ingest endpoint** with a `visitor` name and email,
and agent replies through the control plane under an admin key. That last detail is
what stops every thread reading "Anonymous visitor" — imported conversations carry no
end user, so they have nobody to name.

Edit `fixtures/threads.json` to change the inbox, `fixtures/kb.json` and
`fixtures/crm.json` for the rest.

## Known gaps

- Every seeded conversation is a chat. Email threads would need the signed relay
  endpoint (`MUNIN_EMAIL_RELAY_SECRET` plus a channel with a forwarding address), so
  the inbox screenshot shows one channel badge where a real inbox shows four.
- Review screenshots aren't captured: nothing is pending until the seed also creates
  curation candidates, merge proposals and outreach proposals, so the page is all
  empty states.
- Drafts awaiting approval can't be seeded over HTTP. A draft is a message carrying
  `metadata.kind = "draft_reply"`, and neither the import nor the send endpoint takes
  metadata; only the runner writes them.
