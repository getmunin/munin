---
'@getmunin/db': patch
---

Repair the drizzle migration snapshot chain so `drizzle-kit generate` works again. Snapshots `0003-0005` were byte-identical duplicates with the same `prevId`, which made drizzle-kit abort with a collision error; snapshots for `0006-0038` were never written because migrations after `#22` have been hand-authored. Result: nobody on the team has been able to run the generator, and any hand-written migration risks conflicting with what drizzle would have produced.

Fix: delete the three duplicate snapshots and add a fresh `0038_snapshot.json` generated from the current `schema.ts`, with `prevId` chained to `0002`. drizzle-kit's snapshot validation only enforces parseability and no-duplicate-`prevId`, and the generator diffs against the lex-last snapshot — so this is sufficient to restore `db:generate`. `_journal.json` and all `.sql` files are untouched; `drizzle-orm`'s migrator never reads snapshots, so `db:migrate` behavior is unchanged for both fresh installs and existing databases.
