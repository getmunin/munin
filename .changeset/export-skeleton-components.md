---
'@getmunin/dashboard-pages': patch
---

feat(dashboard-pages): export skeleton loading components

`Skeleton`, `TableSkeleton`, `CardSkeleton`, `CardListSkeleton`, and the `SkeletonColumn` type are now re-exported from the package barrel so downstream consumers can reuse them. Previously they lived in `components/skeleton.tsx` and were only reachable via relative imports inside the package — the `exports` map exposes only `.` and `./server`, so deep imports were blocked too.
