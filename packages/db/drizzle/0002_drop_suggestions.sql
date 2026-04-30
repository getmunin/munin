-- Suggestions feature was relocated to the cloud overlay (`@munin-cloud/feedback`).
-- Drop the OSS tables. Cloud creates `cloud_suggestions` + `cloud_suggestion_votes`
-- via CLOUD_FEEDBACK_DDL during cloud bootstrap.

DROP TABLE IF EXISTS votes CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS suggestions CASCADE;
