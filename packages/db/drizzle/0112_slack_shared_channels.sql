-- Lets several Munin orgs route into the same Slack channel.
--
-- The old (team_id, slack_channel_id) unique index made a channel belong to
-- exactly one org. Nothing inbound resolves an org from the channel alone:
-- thread replies resolve through slack_conversation_links, and buttons carry
-- the conversation, subject or integration they act on. So the uniqueness
-- narrows to one org: within an integration a channel still serves one route.
-- Existing rows already satisfy it, since the old index was strictly wider.
-- (team_id, slack_channel_id) stays indexed for the "who else posts here"
-- lookup that decides whether a message carries its org's name.
DROP INDEX IF EXISTS "slack_channel_routes_team_channel_uq";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "slack_channel_routes_integration_channel_uq" ON "slack_channel_routes" USING btree ("integration_id","slack_channel_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "slack_channel_routes_team_channel_idx" ON "slack_channel_routes" USING btree ("team_id","slack_channel_id");
