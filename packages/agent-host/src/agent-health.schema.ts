import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const agentHealth = pgTable('agent_health', {
  id: text('id').primaryKey(),
  lastProviderErrorCode: text('last_provider_error_code'),
  lastProviderErrorMessage: text('last_provider_error_message'),
  lastErrorAt: timestamp('last_error_at', { withTimezone: true }),
  lastOkAt: timestamp('last_ok_at', { withTimezone: true }),
  createdAt,
  updatedAt,
});

export const AGENT_HEALTH_SINGLETON_DDL = sql`
  CREATE TABLE IF NOT EXISTS agent_health (
    id text PRIMARY KEY DEFAULT 'singleton',
    last_provider_error_code text,
    last_provider_error_message text,
    last_error_at timestamptz,
    last_ok_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT agent_health_singleton_chk CHECK (id = 'singleton')
  );

  INSERT INTO agent_health (id) VALUES ('singleton') ON CONFLICT (id) DO NOTHING;
`;

export const AGENT_HEALTH_MULTI_TENANT_DDL = sql`
  CREATE TABLE IF NOT EXISTS agent_health (
    id text PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
    last_provider_error_code text,
    last_provider_error_message text,
    last_error_at timestamptz,
    last_ok_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
`;
