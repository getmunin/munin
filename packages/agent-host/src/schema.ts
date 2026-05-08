import { sql } from 'drizzle-orm';
import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const agentConfig = pgTable('agent_config', {
  id: text('id').primaryKey(),
  chatModel: text('chat_model').notNull(),
  curatorModel: text('curator_model'),
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
  CREATE TABLE IF NOT EXISTS agent_config (
    id text PRIMARY KEY DEFAULT 'singleton',
    chat_model text NOT NULL DEFAULT 'anthropic/claude-haiku-4.5',
    curator_model text,
    provider_base_url text NOT NULL DEFAULT 'https://openrouter.ai/api/v1',
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
  CREATE TABLE IF NOT EXISTS agent_config (
    id text PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
    chat_model text NOT NULL,
    curator_model text,
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

  ALTER TABLE agent_config ADD COLUMN IF NOT EXISTS curator_model text;

  DROP INDEX IF EXISTS agent_config_enabled_idx;

  ALTER TABLE agent_config DROP COLUMN IF EXISTS enabled;

  CREATE INDEX IF NOT EXISTS agent_config_provisioned_idx
    ON agent_config(id) WHERE provider_api_key_ct IS NOT NULL;
`;
