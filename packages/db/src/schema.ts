/**
 * Munin platform schema (foundational).
 *
 * Domain modules (kb, desk, crm) will add their own tables in later milestones,
 * but everything in this file is shared infrastructure: tenancy, identity,
 * audit, claims, webhooks, suggestions, partners.
 *
 * Tenancy: every org-scoped table carries `org_id` and is governed by RLS.
 * RLS policies live in src/rls.sql (applied during migrations).
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
  vector,
} from 'drizzle-orm/pg-core';
import { makeId } from './id.js';

export const EMBEDDING_DIMENSIONS = 1536;

const id = (prefix: string) =>
  text('id')
    .primaryKey()
    .$defaultFn(() => makeId(prefix));

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

// ───────────────────────────── Partners ──────────────────────────────
// One row per integration partner (e.g. Threll). Highest-privilege keys.
export const partners = pgTable('partners', {
  id: id('ptr'),
  name: text('name').notNull(),
  slug: varchar('slug', { length: 64 }).notNull().unique(),
  partnerKeyHash: text('partner_key_hash').notNull(),
  scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
  consentUrlTemplate: text('consent_url_template'),
  brandingMetadata: jsonb('branding_metadata').$type<Record<string, unknown>>().default({}),
  createdAt,
  updatedAt,
});

// ───────────────────────────── Orgs / Users ──────────────────────────
export const orgs = pgTable(
  'orgs',
  {
    id: id('org'),
    name: text('name').notNull(),
    slug: varchar('slug', { length: 64 }).notNull().unique(),
    partnerId: text('partner_id').references(() => partners.id, { onDelete: 'set null' }),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
    updatedAt,
  },
  (t) => ({
    partnerIdx: index('orgs_partner_idx').on(t.partnerId),
  }),
);

// Identity tables managed by BetterAuth (email/password + Google OAuth in M0).
// Names match BetterAuth's default schema; the auth adapter is wired in
// apps/backend/src/auth/.
export const users = pgTable('users', {
  id: id('usr'),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  name: text('name'),
  image: text('image'),
  createdAt,
  updatedAt,
});

export const sessions = pgTable(
  'sessions',
  {
    id: id('ses'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt,
    updatedAt,
  },
  (t) => ({
    userIdx: index('sessions_user_idx').on(t.userId),
  }),
);

export const accounts = pgTable(
  'accounts',
  {
    id: id('acc'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt,
    updatedAt,
  },
  (t) => ({
    userIdx: index('accounts_user_idx').on(t.userId),
    providerIdx: uniqueIndex('accounts_provider_account_uq').on(t.providerId, t.accountId),
  }),
);

export const verifications = pgTable(
  'verifications',
  {
    id: id('ver'),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt,
    updatedAt,
  },
  (t) => ({
    identifierIdx: index('verifications_identifier_idx').on(t.identifier),
  }),
);

// Membership: which users belong to which orgs (single-org per user in v0.4 but
// schema supports many-to-many for future).
export const orgMembers = pgTable(
  'org_members',
  {
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 32 }).notNull().default('owner'),
    createdAt,
  },
  (t) => ({
    pk: primaryKey({ columns: [t.orgId, t.userId] }),
    userIdx: index('org_members_user_idx').on(t.userId),
  }),
);

// ───────────────────────────── End-users ─────────────────────────────
// People that customer-facing agents act on behalf of. One per org-bound identity.
export const endUsers = pgTable(
  'end_users',
  {
    id: id('eu'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    externalId: text('external_id'),
    email: text('email'),
    phone: text('phone'),
    name: text('name'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
    updatedAt,
  },
  (t) => ({
    orgIdx: index('end_users_org_idx').on(t.orgId),
    externalUq: uniqueIndex('end_users_org_external_uq').on(t.orgId, t.externalId),
    emailIdx: index('end_users_email_idx').on(t.orgId, t.email),
    phoneIdx: index('end_users_phone_idx').on(t.orgId, t.phone),
  }),
);

// ───────────────────────────── Agents ────────────────────────────────
// Internal identity for any agent acting on data, used by audit/claims.
export const agents = pgTable(
  'agents',
  {
    id: id('agt'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    ownerUserId: text('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
    rateLimitPerMin: integer('rate_limit_per_min'),
    rateLimitPerDay: integer('rate_limit_per_day'),
    createdAt,
    updatedAt,
  },
  (t) => ({
    orgIdx: index('agents_org_idx').on(t.orgId),
  }),
);

// ───────────────────────────── OAuth (MCP spec) ──────────────────────
// Dynamically-registered OAuth clients (per the MCP OAuth 2.1 flow).
export const oauthClients = pgTable(
  'oauth_clients',
  {
    id: id('oac'),
    orgId: text('org_id').references(() => orgs.id, { onDelete: 'cascade' }),
    clientId: text('client_id').notNull().unique(),
    clientSecretHash: text('client_secret_hash'),
    name: text('name').notNull(),
    redirectUris: jsonb('redirect_uris').$type<string[]>().notNull().default([]),
    grantTypes: jsonb('grant_types').$type<string[]>().notNull().default([]),
    scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
    updatedAt,
  },
  (t) => ({
    orgIdx: index('oauth_clients_org_idx').on(t.orgId),
  }),
);

// Tokens issued via OAuth or as delegated end-user JWTs.
export const tokens = pgTable(
  'tokens',
  {
    id: id('tok'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 32 }).notNull(),
    // 'oauth_access' | 'oauth_refresh' | 'delegated_end_user' | 'guest'
    tokenHash: text('token_hash').notNull().unique(),
    scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
    audiences: jsonb('audiences').$type<('admin' | 'self_service')[]>().notNull().default([]),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    agentId: text('agent_id').references(() => agents.id, { onDelete: 'cascade' }),
    oauthClientId: text('oauth_client_id').references(() => oauthClients.id, { onDelete: 'cascade' }),
    endUserId: text('end_user_id').references(() => endUsers.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
  },
  (t) => ({
    orgIdx: index('tokens_org_idx').on(t.orgId),
    typeIdx: index('tokens_type_idx').on(t.type),
    endUserIdx: index('tokens_end_user_idx').on(t.endUserId),
  }),
);

// Long-lived admin API keys (and partner keys, scoped via type).
export const apiKeys = pgTable(
  'api_keys',
  {
    id: id('akey'),
    orgId: text('org_id').references(() => orgs.id, { onDelete: 'cascade' }),
    partnerId: text('partner_id').references(() => partners.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 32 }).notNull(), // 'admin' | 'partner'
    name: text('name').notNull(),
    keyHash: text('key_hash').notNull().unique(),
    keyPrefix: varchar('key_prefix', { length: 16 }).notNull(),
    scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt,
  },
  (t) => ({
    orgIdx: index('api_keys_org_idx').on(t.orgId),
    partnerIdx: index('api_keys_partner_idx').on(t.partnerId),
    prefixIdx: index('api_keys_prefix_idx').on(t.keyPrefix),
  }),
);

// ───────────────────────────── Audit & events ────────────────────────
export const auditLog = pgTable(
  'audit_log',
  {
    id: id('aud'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    actorType: varchar('actor_type', { length: 32 }).notNull(),
    // 'user' | 'admin_agent' | 'end_user_agent' | 'partner' | 'system'
    actorId: text('actor_id'),
    tool: text('tool'),
    method: text('method'),
    target: jsonb('target').$type<{ type: string; id: string }>(),
    args: jsonb('args').$type<Record<string, unknown>>(),
    correlationId: text('correlation_id'),
    result: varchar('result', { length: 16 }),
    error: text('error'),
    createdAt,
  },
  (t) => ({
    orgIdx: index('audit_log_org_idx').on(t.orgId, t.createdAt),
    correlationIdx: index('audit_log_correlation_idx').on(t.correlationId),
    actorIdx: index('audit_log_actor_idx').on(t.actorType, t.actorId),
  }),
);

export const events = pgTable(
  'events',
  {
    id: id('evt'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    actorId: text('actor_id'),
    correlationId: text('correlation_id'),
    hopCount: integer('hop_count').notNull().default(0),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
  },
  (t) => ({
    orgIdx: index('events_org_idx').on(t.orgId, t.createdAt),
    typeIdx: index('events_type_idx').on(t.type),
    correlationIdx: index('events_correlation_idx').on(t.correlationId),
  }),
);

// ───────────────────────────── Claims ────────────────────────────────
// Soft locks: "agent X is working on entity Y for the next N minutes."
export const claims = pgTable(
  'claims',
  {
    id: id('clm'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    createdAt,
  },
  (t) => ({
    entityIdx: index('claims_entity_idx').on(t.orgId, t.entityType, t.entityId),
    expiresIdx: index('claims_expires_idx').on(t.expiresAt),
  }),
);

// ───────────────────────────── Webhooks ──────────────────────────────
export const webhooks = pgTable(
  'webhooks',
  {
    id: id('whk'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    secret: text('secret').notNull(),
    events: jsonb('events').$type<string[]>().notNull().default([]),
    active: boolean('active').notNull().default(true),
    createdAt,
    updatedAt,
  },
  (t) => ({
    orgIdx: index('webhooks_org_idx').on(t.orgId),
  }),
);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: id('whd'),
    webhookId: text('webhook_id')
      .notNull()
      .references(() => webhooks.id, { onDelete: 'cascade' }),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    attempt: integer('attempt').notNull().default(0),
    statusCode: integer('status_code'),
    durationMs: integer('duration_ms'),
    error: text('error'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    createdAt,
  },
  (t) => ({
    webhookIdx: index('webhook_deliveries_webhook_idx').on(t.webhookId),
    pendingIdx: index('webhook_deliveries_pending_idx').on(t.nextAttemptAt),
  }),
);

// ───────────────────────────── Bootstrap state ───────────────────────
// Conversational config progress per app per org.
export const bootstrapState = pgTable(
  'bootstrap_state',
  {
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    appKey: varchar('app_key', { length: 32 }).notNull(),
    // 'kb' | 'desk' | 'crm' | future
    completedSteps: jsonb('completed_steps').$type<string[]>().notNull().default([]),
    answers: jsonb('answers').$type<Record<string, unknown>>().notNull().default({}),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    updatedAt,
    createdAt,
  },
  (t) => ({
    pk: primaryKey({ columns: [t.orgId, t.appKey] }),
  }),
);

// ───────────────────────────── Suggestions / votes ───────────────────
export const suggestions = pgTable(
  'suggestions',
  {
    id: id('sug'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body').notNull(),
    appScope: varchar('app_scope', { length: 32 }),
    status: varchar('status', { length: 16 }).notNull().default('open'),
    // 'open' | 'planned' | 'in_progress' | 'done' | 'wontfix' | 'duplicate'
    createdByType: varchar('created_by_type', { length: 16 }).notNull(),
    // 'agent' | 'user'
    createdById: text('created_by_id').notNull(),
    voteCount: integer('vote_count').notNull().default(0),
    public: boolean('public').notNull().default(false),
    duplicateOfId: text('duplicate_of_id'),
    createdAt,
    updatedAt,
  },
  (t) => ({
    orgIdx: index('suggestions_org_idx').on(t.orgId),
    statusIdx: index('suggestions_status_idx').on(t.status),
    publicIdx: index('suggestions_public_idx').on(t.public, t.voteCount),
  }),
);

export const votes = pgTable(
  'votes',
  {
    suggestionId: text('suggestion_id')
      .notNull()
      .references(() => suggestions.id, { onDelete: 'cascade' }),
    voterType: varchar('voter_type', { length: 16 }).notNull(),
    voterId: text('voter_id').notNull(),
    comment: text('comment'),
    createdAt,
  },
  (t) => ({
    pk: primaryKey({ columns: [t.suggestionId, t.voterType, t.voterId] }),
  }),
);

// ───────────────────────────── Rate limits ──────────────────────────
// Token-bucket / sliding-window counters per org per token-type.
// Postgres-only impl for v0.4; Redis later if hot.
export const rateLimitCounters = pgTable(
  'rate_limit_counters',
  {
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    bucket: varchar('bucket', { length: 64 }).notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: bigint('count', { mode: 'number' }).notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.orgId, t.bucket, t.windowStart] }),
  }),
);

// ───────────────────────── Knowledge Base (M1) ───────────────────────
// Spaces are KB containers (Engineering, Customer Docs, etc.). Slug is
// unique per org so agents can address them in conversation by slug.
export const kbSpaces = pgTable(
  'kb_spaces',
  {
    id: id('ksp'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: varchar('slug', { length: 64 }).notNull(),
    description: text('description'),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
    updatedAt,
  },
  (t) => ({
    orgIdx: index('kb_spaces_org_idx').on(t.orgId),
    orgSlugUq: uniqueIndex('kb_spaces_org_slug_uq').on(t.orgId, t.slug),
  }),
);

// `version` is the optimistic-concurrency token (clients must pass `if_version`
// on writes). `content_hash` lets us skip re-embedding when the body hasn't
// actually changed (e.g. metadata-only patches).
export const kbDocuments = pgTable(
  'kb_documents',
  {
    id: id('kdoc'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    spaceId: text('space_id')
      .notNull()
      .references(() => kbSpaces.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body').notNull(),
    public: boolean('public').notNull().default(false),
    version: integer('version').notNull().default(1),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    createdByType: varchar('created_by_type', { length: 16 }).notNull(),
    // 'agent' | 'user'
    createdById: text('created_by_id').notNull(),
    updatedByType: varchar('updated_by_type', { length: 16 }).notNull(),
    updatedById: text('updated_by_id').notNull(),
    createdAt,
    updatedAt,
  },
  (t) => ({
    orgIdx: index('kb_documents_org_idx').on(t.orgId),
    spaceIdx: index('kb_documents_space_idx').on(t.spaceId),
    publicIdx: index('kb_documents_public_idx').on(t.orgId, t.public),
  }),
);

// One row per chunk produced by the chunker. Embeddings are populated
// asynchronously after the document write commits — `embedding` is nullable
// so the document is queryable via FTS even before vectors land.
export const kbDocumentChunks = pgTable(
  'kb_document_chunks',
  {
    id: id('kch'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    documentId: text('document_id')
      .notNull()
      .references(() => kbDocuments.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    tokenCount: integer('token_count').notNull(),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    createdAt,
  },
  (t) => ({
    documentIdx: index('kb_chunks_document_idx').on(t.documentId),
    orgIdx: index('kb_chunks_org_idx').on(t.orgId),
    docOrderUq: uniqueIndex('kb_chunks_doc_order_uq').on(t.documentId, t.chunkIndex),
  }),
);

// Immutable snapshots taken on every successful write so kb_restore_version
// can roll back to any prior state.
export const kbDocumentVersions = pgTable(
  'kb_document_versions',
  {
    id: id('kver'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    documentId: text('document_id')
      .notNull()
      .references(() => kbDocuments.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    public: boolean('public').notNull(),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    createdByType: varchar('created_by_type', { length: 16 }).notNull(),
    createdById: text('created_by_id').notNull(),
    createdAt,
  },
  (t) => ({
    docVersionUq: uniqueIndex('kb_versions_doc_version_uq').on(t.documentId, t.version),
    orgIdx: index('kb_versions_org_idx').on(t.orgId),
  }),
);

// ───────────────────────── Helpdesk (M3) ─────────────────────────────
// Channels: where customers reach the org. v0.4 ships email + a built-in
// "chat" channel for self-service conversations; voice / sms come later.
export const deskChannels = pgTable(
  'desk_channels',
  {
    id: id('dch'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 16 }).notNull(),
    // 'email' | 'voice' | 'chat' | 'sms'
    name: text('name').notNull(),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    active: boolean('active').notNull().default(true),
    createdAt,
    updatedAt,
  },
  (t) => ({
    orgIdx: index('desk_channels_org_idx').on(t.orgId),
    typeIdx: index('desk_channels_type_idx').on(t.orgId, t.type),
  }),
);

// Topics: lightweight categorization (Billing, Support, Refunds…). Slug-unique
// per org so agents can address them in conversation.
export const deskTopics = pgTable(
  'desk_topics',
  {
    id: id('dtp'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: varchar('slug', { length: 64 }).notNull(),
    color: varchar('color', { length: 16 }),
    createdAt,
    updatedAt,
  },
  (t) => ({
    orgIdx: index('desk_topics_org_idx').on(t.orgId),
    slugUq: uniqueIndex('desk_topics_org_slug_uq').on(t.orgId, t.slug),
  }),
);

// Contacts: helpdesk-specific view of a person. Links to EndUser when one
// exists (so the same human in CRM, helpdesk, and KB-self-service is visibly
// the same entity). For pre-EndUser flows (anonymous contact form, etc.)
// the FK is nullable so contacts can land first.
export const deskContacts = pgTable(
  'desk_contacts',
  {
    id: id('dct'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    endUserId: text('end_user_id').references(() => endUsers.id, { onDelete: 'set null' }),
    name: text('name'),
    email: text('email'),
    phone: text('phone'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
    updatedAt,
  },
  (t) => ({
    orgIdx: index('desk_contacts_org_idx').on(t.orgId),
    emailIdx: index('desk_contacts_email_idx').on(t.orgId, t.email),
    endUserIdx: index('desk_contacts_end_user_idx').on(t.endUserId),
  }),
);

// Conversations: the unit of work (vs the legacy "ticket"). Spans multiple
// channels in principle; in v0.4 a conversation is bound to one channel at
// creation but threading rules (M3+) can span channels via the same contact.
//
// `display_id` is per-org via a CTE-and-coalesce on insert (postgres SEQUENCE
// per org would be cleaner; for v0.4 we MAX() + 1 inside a transaction —
// fine at our scale and simpler than CREATE SEQUENCE per-org plumbing).
export const deskConversations = pgTable(
  'desk_conversations',
  {
    id: id('dcv'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    displayId: integer('display_id').notNull(),
    channelId: text('channel_id')
      .notNull()
      .references(() => deskChannels.id, { onDelete: 'restrict' }),
    contactId: text('contact_id').references(() => deskContacts.id, { onDelete: 'set null' }),
    endUserId: text('end_user_id').references(() => endUsers.id, { onDelete: 'set null' }),
    topicId: text('topic_id').references(() => deskTopics.id, { onDelete: 'set null' }),
    assigneeUserId: text('assignee_user_id').references(() => users.id, { onDelete: 'set null' }),
    subject: text('subject'),
    status: varchar('status', { length: 16 }).notNull().default('open'),
    // 'open' | 'snoozed' | 'closed' | 'spam'
    snoozeUntil: timestamp('snooze_until', { withTimezone: true }),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
    updatedAt,
  },
  (t) => ({
    orgIdx: index('desk_conversations_org_idx').on(t.orgId),
    statusIdx: index('desk_conversations_status_idx').on(t.orgId, t.status),
    endUserIdx: index('desk_conversations_end_user_idx').on(t.endUserId),
    contactIdx: index('desk_conversations_contact_idx').on(t.contactId),
    displayIdUq: uniqueIndex('desk_conversations_display_uq').on(t.orgId, t.displayId),
    lastMsgIdx: index('desk_conversations_last_msg_idx').on(t.orgId, t.lastMessageAt),
  }),
);

// Messages: posts inside a conversation. `internal=true` is staff-only
// (agent draft, side-comment); end-user audience never sees them. Author
// tags `(author_type, author_id)` so audit trails can name who said what.
export const deskMessages = pgTable(
  'desk_messages',
  {
    id: id('dms'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => deskConversations.id, { onDelete: 'cascade' }),
    authorType: varchar('author_type', { length: 16 }).notNull(),
    // 'user' | 'agent' | 'end_user' | 'system'
    authorId: text('author_id').notNull(),
    body: text('body').notNull(),
    bodyHtml: text('body_html'),
    internal: boolean('internal').notNull().default(false),
    inReplyToId: text('in_reply_to_id'),
    attachments: jsonb('attachments').$type<unknown[]>().notNull().default([]),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
  },
  (t) => ({
    conversationIdx: index('desk_messages_conv_idx').on(t.conversationId, t.createdAt),
    orgIdx: index('desk_messages_org_idx').on(t.orgId),
  }),
);

// ───────────────────────── CRM (M4) ───────────────────────────────────
// Modern CRM: relationships as a graph, AI-native fields as first-class
// columns (so agents don't pollute description/notes), compliance fields
// (do_not_contact, unsubscribed_at, last_contacted_at) gate outbound.

export const crmCompanies = pgTable(
  'crm_companies',
  {
    id: id('cco'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    domain: text('domain'),
    ownerUserId: text('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    customFields: jsonb('custom_fields').$type<Record<string, unknown>>().notNull().default({}),
    aiSummary: text('ai_summary'),
    aiSummaryAt: timestamp('ai_summary_at', { withTimezone: true }),
    aiNextAction: text('ai_next_action'),
    engagementScore: integer('engagement_score').notNull().default(0),
    lastAiTouchAt: timestamp('last_ai_touch_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (t) => ({
    orgIdx: index('crm_companies_org_idx').on(t.orgId),
    domainIdx: index('crm_companies_domain_idx').on(t.orgId, t.domain),
  }),
);

export const crmContacts = pgTable(
  'crm_contacts',
  {
    id: id('cct'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    endUserId: text('end_user_id').references(() => endUsers.id, { onDelete: 'set null' }),
    companyId: text('company_id').references(() => crmCompanies.id, { onDelete: 'set null' }),
    name: text('name'),
    email: text('email'),
    phone: text('phone'),
    title: text('title'),
    address: text('address'),
    ownerUserId: text('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    customFields: jsonb('custom_fields').$type<Record<string, unknown>>().notNull().default({}),
    aiSummary: text('ai_summary'),
    aiSummaryAt: timestamp('ai_summary_at', { withTimezone: true }),
    aiNextAction: text('ai_next_action'),
    engagementScore: integer('engagement_score').notNull().default(0),
    lastAiTouchAt: timestamp('last_ai_touch_at', { withTimezone: true }),
    doNotContact: boolean('do_not_contact').notNull().default(false),
    unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true }),
    lastContactedAt: timestamp('last_contacted_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (t) => ({
    orgIdx: index('crm_contacts_org_idx').on(t.orgId),
    emailIdx: index('crm_contacts_email_idx').on(t.orgId, t.email),
    phoneIdx: index('crm_contacts_phone_idx').on(t.orgId, t.phone),
    endUserIdx: index('crm_contacts_end_user_idx').on(t.endUserId),
    companyIdx: index('crm_contacts_company_idx').on(t.companyId),
  }),
);

export const crmPipelines = pgTable(
  'crm_pipelines',
  {
    id: id('cpl'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: varchar('slug', { length: 64 }).notNull(),
    position: integer('position').notNull().default(0),
    createdAt,
    updatedAt,
  },
  (t) => ({
    slugUq: uniqueIndex('crm_pipelines_slug_uq').on(t.orgId, t.slug),
  }),
);

export const crmStages = pgTable(
  'crm_stages',
  {
    id: id('cst'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    pipelineId: text('pipeline_id')
      .notNull()
      .references(() => crmPipelines.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    winLoss: varchar('win_loss', { length: 8 }).notNull().default('open'),
    // 'open' | 'won' | 'lost'
    createdAt,
    updatedAt,
  },
  (t) => ({
    pipelineIdx: index('crm_stages_pipeline_idx').on(t.pipelineId, t.position),
  }),
);

export const crmDeals = pgTable(
  'crm_deals',
  {
    id: id('cdl'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    pipelineId: text('pipeline_id')
      .notNull()
      .references(() => crmPipelines.id, { onDelete: 'restrict' }),
    stageId: text('stage_id')
      .notNull()
      .references(() => crmStages.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }),
    currency: varchar('currency', { length: 8 }),
    primaryContactId: text('primary_contact_id').references(() => crmContacts.id, {
      onDelete: 'set null',
    }),
    companyId: text('company_id').references(() => crmCompanies.id, { onDelete: 'set null' }),
    ownerUserId: text('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    expectedCloseAt: timestamp('expected_close_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    aiSummary: text('ai_summary'),
    aiSummaryAt: timestamp('ai_summary_at', { withTimezone: true }),
    aiNextAction: text('ai_next_action'),
    engagementScore: integer('engagement_score').notNull().default(0),
    lastAiTouchAt: timestamp('last_ai_touch_at', { withTimezone: true }),
    customFields: jsonb('custom_fields').$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
    updatedAt,
  },
  (t) => ({
    orgIdx: index('crm_deals_org_idx').on(t.orgId),
    pipelineIdx: index('crm_deals_pipeline_idx').on(t.pipelineId),
    stageIdx: index('crm_deals_stage_idx').on(t.stageId),
    contactIdx: index('crm_deals_contact_idx').on(t.primaryContactId),
    companyIdx: index('crm_deals_company_idx').on(t.companyId),
  }),
);

export const crmActivities = pgTable(
  'crm_activities',
  {
    id: id('cac'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 16 }).notNull(),
    // 'note' | 'call' | 'email' | 'meeting' | 'task'
    subject: text('subject'),
    body: text('body'),
    contactId: text('contact_id').references(() => crmContacts.id, { onDelete: 'cascade' }),
    companyId: text('company_id').references(() => crmCompanies.id, { onDelete: 'cascade' }),
    dealId: text('deal_id').references(() => crmDeals.id, { onDelete: 'cascade' }),
    endUserId: text('end_user_id').references(() => endUsers.id, { onDelete: 'set null' }),
    actorType: varchar('actor_type', { length: 16 }).notNull(),
    // 'user' | 'agent' | 'end_user' | 'system'
    actorId: text('actor_id').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
  },
  (t) => ({
    orgIdx: index('crm_activities_org_idx').on(t.orgId, t.createdAt),
    contactIdx: index('crm_activities_contact_idx').on(t.contactId, t.createdAt),
    dealIdx: index('crm_activities_deal_idx').on(t.dealId, t.createdAt),
    endUserIdx: index('crm_activities_end_user_idx').on(t.endUserId),
  }),
);

// Relationships: foundation for graph-y associations (champion / decision-
// maker / blocker on a deal; "introduced by" between contacts; "former
// company" between contact and company). Polymorphic via from_type/to_type
// + from_id/to_id; the service enforces valid (type, id) pairs at write
// time. Time-bounded via started_at / ended_at so historical relationships
// stick around without obscuring current ones.
export const crmRelationships = pgTable(
  'crm_relationships',
  {
    id: id('crl'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    fromType: varchar('from_type', { length: 16 }).notNull(),
    fromId: text('from_id').notNull(),
    toType: varchar('to_type', { length: 16 }).notNull(),
    toId: text('to_id').notNull(),
    role: varchar('role', { length: 64 }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
  },
  (t) => ({
    orgIdx: index('crm_relationships_org_idx').on(t.orgId),
    fromIdx: index('crm_relationships_from_idx').on(t.fromType, t.fromId),
    toIdx: index('crm_relationships_to_idx').on(t.toType, t.toId),
  }),
);

// All the tables exported as a single namespace for convenience:
export const allTables = {
  partners,
  orgs,
  users,
  sessions,
  accounts,
  verifications,
  orgMembers,
  endUsers,
  agents,
  oauthClients,
  tokens,
  apiKeys,
  auditLog,
  events,
  claims,
  webhooks,
  webhookDeliveries,
  bootstrapState,
  suggestions,
  votes,
  rateLimitCounters,
  kbSpaces,
  kbDocuments,
  kbDocumentChunks,
  kbDocumentVersions,
  deskChannels,
  deskTopics,
  deskContacts,
  deskConversations,
  deskMessages,
  crmCompanies,
  crmContacts,
  crmPipelines,
  crmStages,
  crmDeals,
  crmActivities,
  crmRelationships,
};

export type AllTables = typeof allTables;
export { sql };
