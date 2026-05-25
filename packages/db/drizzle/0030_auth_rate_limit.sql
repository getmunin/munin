-- Shared rate-limit storage for better-auth's per-endpoint throttling.
-- Replaces the in-process Map() so the backend can scale beyond one
-- replica without diluting the configured limits. better-auth's
-- `createDatabaseStorageWrapper` writes here when `rateLimit.storage`
-- is set to `'database'` on the auth factory.
CREATE TABLE IF NOT EXISTS "auth_rate_limit" (
    "id" text PRIMARY KEY NOT NULL,
    "key" text NOT NULL,
    "count" integer DEFAULT 0 NOT NULL,
    "last_request" bigint
);
CREATE INDEX IF NOT EXISTS "auth_rate_limit_key_idx" ON "auth_rate_limit" ("key");
