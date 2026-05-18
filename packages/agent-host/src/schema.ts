import { sql } from 'drizzle-orm';
import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const agentConfig = pgTable('agent_config', {
  id: text('id').primaryKey(),
  fastModel: text('fast_model').notNull(),
  smartModel: text('smart_model'),
  providerBaseUrl: text('provider_base_url').notNull(),
  providerApiKeyCt: text('provider_api_key_ct'),
  adminApiKeyCt: text('admin_api_key_ct'),
  adminApiKeyId: text('admin_api_key_id'),
  maxHistoryChars: integer('max_history_chars').notNull().default(32_000),
  maxToolIterations: integer('max_tool_iterations').notNull().default(8),
  debounceMs: integer('debounce_ms').notNull().default(500),
  createdAt,
  updatedAt,
});

export const SINGLETON_ID = 'singleton' as const;

export const AGENT_HOST_SINGLETON_DDL = sql`
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'agent_config' AND column_name = 'chat_model'
    ) THEN
      ALTER TABLE agent_config RENAME COLUMN chat_model TO fast_model;
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'agent_config' AND column_name = 'curator_model'
    ) THEN
      ALTER TABLE agent_config RENAME COLUMN curator_model TO smart_model;
    END IF;
  END $$;

  CREATE TABLE IF NOT EXISTS agent_config (
    id text PRIMARY KEY DEFAULT 'singleton',
    fast_model text NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
    smart_model text,
    provider_base_url text NOT NULL DEFAULT 'https://api.anthropic.com/v1',
    provider_api_key_ct text,
    admin_api_key_ct text,
    admin_api_key_id text,
    max_history_chars integer NOT NULL DEFAULT 32000,
    max_tool_iterations integer NOT NULL DEFAULT 8,
    debounce_ms integer NOT NULL DEFAULT 500,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT agent_config_singleton_chk CHECK (id = 'singleton')
  );

  INSERT INTO agent_config (id) VALUES ('singleton') ON CONFLICT (id) DO NOTHING;

  DROP INDEX IF EXISTS agent_config_enabled_idx;

  ALTER TABLE agent_config DROP COLUMN IF EXISTS enabled;

  CREATE INDEX IF NOT EXISTS agent_config_provisioned_idx
    ON agent_config(id) WHERE provider_api_key_ct IS NOT NULL;
`;

export const AGENT_HOST_MULTI_TENANT_DDL = sql`
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'agent_config' AND column_name = 'chat_model'
    ) THEN
      ALTER TABLE agent_config RENAME COLUMN chat_model TO fast_model;
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'agent_config' AND column_name = 'curator_model'
    ) THEN
      ALTER TABLE agent_config RENAME COLUMN curator_model TO smart_model;
    END IF;
  END $$;

  CREATE TABLE IF NOT EXISTS agent_config (
    id text PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
    fast_model text NOT NULL,
    smart_model text,
    provider_base_url text NOT NULL,
    provider_api_key_ct text,
    admin_api_key_ct text,
    admin_api_key_id text,
    max_history_chars integer NOT NULL DEFAULT 32000,
    max_tool_iterations integer NOT NULL DEFAULT 8,
    debounce_ms integer NOT NULL DEFAULT 500,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );

  ALTER TABLE agent_config ADD COLUMN IF NOT EXISTS smart_model text;

  DROP INDEX IF EXISTS agent_config_enabled_idx;

  ALTER TABLE agent_config DROP COLUMN IF EXISTS enabled;

  CREATE INDEX IF NOT EXISTS agent_config_provisioned_idx
    ON agent_config(id) WHERE provider_api_key_ct IS NOT NULL;
`;
