-- Drop the suggestions / votes tables. The feature is no longer part of
-- Munin's open-source surface.

DROP TABLE IF EXISTS votes CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS suggestions CASCADE;
