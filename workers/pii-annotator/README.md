# pii-annotator

The optional NER worker behind Munin's MCP pseudonymization.

External MCP callers — claude.ai, Claude Code, API keys — get tool results with
personal data pseudonymized. Most of that happens inside the backend with nothing
to install: national IDs, emails, phone numbers, bank accounts, and every name
the org already holds as a contact or end user. What the backend cannot know is
a name it has never seen: a third party mentioned in the text of a message. This
worker finds those.

It claims conversation messages from the backend, runs person-name NER over
them, and submits the names it finds. It never connects to Postgres; every read
and write goes through the backend, under the owning org's tenancy.

## Tiers

| Tier | Image target | Models | Footprint |
|---|---|---|---|
| 0 | none | the backend's own detectors only | nothing to run |
| 1 | `lite` | spaCy `nb_core_news_md` | 54 MB of weights, no torch |
| 2 | `full` | spaCy `nb_core_news_lg` + `fastino/gliner2.5-multi-v1` | ~1.7 GB of weights plus CPU torch |

On a benchmark of 523 Norwegian support messages, scored against the names of
known contacts, `lite` found 72% of person names and `full` 82%, at roughly 15×
the compute. The spaCy models are Bokmål; GLiNER2.5 is multilingual.

Model weights are downloaded from upstream on first run into `/models`. Mount a
volume there so later runs reuse them. Check each model's licence before running
it for a commercial deployment.

## Configuration

Set on the backend:

| Variable | |
|---|---|
| `MUNIN_PII_NER_ENABLED=true` | accept workers, and report messages the worker has not reached yet as `pending` |
| `MUNIN_PII_WORKER_SECRET` | at least 24 characters, e.g. `openssl rand -hex 32` |

Set on the worker:

| Variable | Default | |
|---|---|---|
| `MUNIN_API_URL` | — | the backend, e.g. `http://backend:3001` |
| `MUNIN_PII_WORKER_SECRET` | — | the same secret |
| `PII_TIER` | set by the image target | `lite` or `full` |
| `PII_DETECTOR_VERSION` | 100 (`lite`), 200 (`full`) | see below |
| `PII_BATCH_SIZE` | 32 | messages per claim |
| `PII_LEASE_SECONDS` | 900 | how long a claim is held before another worker may take it |
| `PII_LOOP_INTERVAL_SECONDS` | 300 | pause between sweeps in `--loop` mode |
| `PII_MAX_BATCHES` | 0 (no limit) | cap one run, e.g. for a time-boxed job |
| `PII_CACHE_DIR` | `/models` | where weights are cached |
| `PII_GLINER_THRESHOLD` | 0.5 | GLiNER confidence floor |

To rotate the secret, set `MUNIN_PII_WORKER_SECRET=new,old` on the backend,
move the worker to `new`, then drop `old`. The worker uses the first value.

## Detector versions

The backend re-annotates every message stamped with a lower detector version
than the one a worker claims with. Switching from `lite` to `full` therefore
re-runs history on its own, and switching back keeps the better annotations. A
worker at an older version can never overwrite newer results. Bump
`PII_DETECTOR_VERSION` whenever you change models.

## Running it

**Docker Compose.** The service sits behind the `pii` profile, so it is off
unless you ask for it:

```sh
# .env: MUNIN_PII_NER_ENABLED=true and MUNIN_PII_WORKER_SECRET=...
docker compose --profile pii up -d
MUNIN_PII_TIER=full docker compose --profile pii up -d --build   # the full tier
```

It runs with `--loop`. To run it from host cron instead, without holding the
memory between sweeps:

```sh
docker compose run --rm pii-annotator --once
```

**Kubernetes.** Run the image as a `CronJob` with `--once`, a volume at
`/models`, and the two environment variables.

**Scheduled batch jobs.** Any run-to-completion scheduler works the same way:
`--once` drains the backlog and exits. A job that starts cold downloads the
weights on every run unless `/models` is backed by persistent storage.

## Development

```sh
uv run --no-project --with pytest python -m pytest
```

The tests use fake models and a fake backend, so they need neither spaCy nor
torch.
