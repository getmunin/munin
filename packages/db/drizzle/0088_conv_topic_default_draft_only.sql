-- New topics arrive under review rather than inheriting the channel default:
-- a topic nobody has judged yet should draft, not auto-send. An explicit NULL
-- still means "inherit", and stays available as a deliberate choice.
ALTER TABLE "conv_topics" ALTER COLUMN "agent_mode" SET DEFAULT 'draft_only';
