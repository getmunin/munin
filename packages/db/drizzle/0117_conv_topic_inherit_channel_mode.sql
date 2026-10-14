-- New topics inherit the conversation's mode (and so the channel's) instead of
-- forcing drafts. Whether replies send or wait for review is now chosen
-- explicitly when a channel is created; a topic override is an exception an
-- operator sets on purpose. Existing topic rows keep whatever mode they have.
ALTER TABLE "conv_topics" ALTER COLUMN "agent_mode" DROP DEFAULT;
