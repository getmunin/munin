ALTER TABLE "conv_conversations"
  ADD COLUMN IF NOT EXISTS "agent_mode" varchar(16) NOT NULL DEFAULT 'auto';
