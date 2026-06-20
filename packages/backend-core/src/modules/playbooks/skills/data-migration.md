---
title: 'Playbook: Data migration (self-host ⇄ cloud)'
description: Move one org's data between two Munin servers (self-hosted and cloud, either direction) using the per-module export/import tools — in foreign-key order, threading the returned idMap so dependent records resolve their parents on the target.
audiences: [admin]
---

# Data migration (self-host ⇄ cloud)

Move an org's content from a **source** Munin server to a **target** server (self-host → cloud, cloud → self-host, or server → server). Every module exposes a symmetric `*_export` / `*_import` tool pair; this playbook sequences them.

This is a **playbook** — it composes per-module transfer tools. You run it as an agent connected to *both* servers (two MCP connections, or two admin API keys), reading from the source and writing to the target.

## How it works

- **Export** tools return portable JSON `records` (no embeddings, no secrets, no api keys). **Import** tools upsert those records and return `{ created, updated, skipped, idMap, warnings }`.
- The **`idMap`** maps a source record id to the id it got on the target. Records reference their parents by *source* id; import rewrites those to target ids using the idMap. **Thread the idMap forward**: pass the idMap returned by one import into the `idMap` argument of every subsequent import, so children resolve parents that were created earlier — even across modules.
- Imports are **idempotent** where a natural key exists (slugs, emails, locale codes, `(collection, slug, locale)`): re-running reports `updated`/`skipped` instead of duplicating. Append-only rows (conversation messages, analytics events) dedupe only within a run via the idMap.

## Order

Run modules in this order and carry one growing `idMap` through all of them:

1. **KB** — `kb_export` → `kb_import`
2. **CRM** — `crm_export` → `crm_import` (pass the idMap from KB; harmless, keeps one map)
3. **CMS** — `cms_export` → `cms_import` (assets included as base64 ≤ 5 MB; re-uploaded to the target's storage)
4. **Conversations** — `conv_export` → `conv_import`
5. **Outreach** — `outreach_export` → `outreach_import` (**must** run after CRM and Conv: campaigns reference a CRM segment + conv channel, proposals reference CRM contacts/conversations — all resolved via the carried idMap; campaigns import **disabled**)
6. **Analytics** — `analytics_export_config` → then page `analytics_export_events` → `analytics_import`

For each step:

```
result = <module>_import({ records: <module>_export().records, idMap: carriedIdMap })
carriedIdMap = result.idMap   // feed into the next import
inspect result.warnings
```

### Analytics is paginated

Events are high-volume. After importing config (trackers + visitor identities):

```
cursor = null
loop:
  page = analytics_export_events({ cursor })
  analytics_import({ records: { events: page.records }, idMap: carriedIdMap })
  if page.nextCursor == null: break
  cursor = page.nextCursor
```

## After import: re-enter secrets

Secrets are **never** exported (they are encrypted with the source server's key). Imports recreate the owning row and emit a warning. Resolve each:

- **Conversation channels** — imported with empty `config`. Re-enter credentials on the target (`skill://conv/setup-email-channel`, or the channel's setup tool) before the channel can send/receive.
- **Outreach campaigns** — imported **disabled** (`enabled: false`). Re-enable each (`outreach_update_campaign`) once its channel credentials are back in place.
- **Analytics trackers** — `identity_verification_secret` is blank. Mint/rotate a fresh one on the target (`analytics_rotate_tracker_identity_secret`) and update any embedding/site that signs identity calls.

Always read `result.warnings` from every import and act on them.

## Scope / limitations

- **Embeddings** are regenerated on the target (KB documents, CMS entries) using the target's embedding provider — never copied.
- **End-users and agents are not part of content transfer.** They are identity, provisioned per server. Analytics visitor-identity bridges and some conversation links reference end-users; on a fresh target those rows are skipped with a warning until the corresponding end-users exist. Provision end-users on the target first if you need those links to resolve.
- **Infrastructure is never moved**: users/sessions, OAuth clients, API keys, audit log, webhooks secrets. Re-create them on the target.
- CMS assets larger than 5 MB are exported as metadata only (warning emitted); move those files out of band.

## Verify

After a full run, spot-check the target: `kb_list_spaces` / `kb_search`, `crm_list_contacts`, `cms_list_entries`, `conv_list_conversations`, `analytics_list_top_subjects`. Counts and a working search (proving re-embedding) confirm the move.
