/**
 * Munin platform schema (foundational).
 *
 * Domain modules (kb, desk, crm) will add their own tables in later milestones,
 * but everything in this file is shared infrastructure: tenancy, identity,
 * audit, claims, webhooks.
 *
 * Tenancy: every org-scoped table carries `org_id` and is governed by RLS.
 * RLS policies live in src/sql/rls.sql (applied during migrations).
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
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { makeId } from './id.js';

export const EMBEDDING_DIMENSIONS = 1536;

const id = (prefix: string) =>
  text('id')
    .primaryKey()
    .$defaultFn(() => makeId(prefix));

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

// ───────────────────────────── Orgs / Users ──────────────────────────
export const orgs = pgTable('orgs', {
  id: id('org'),
  name: text('name').notNull(),
  slug: varchar('slug', { length: 64 }).notNull().unique(),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  createdAt,
  updatedAt,
});

export const assistants = pgTable(
  'assistants',
  {
    id: id('ast'),
    orgId: text('org_id')
      .notNull()
      .references((): AnyPgColumn => orgs.id, { onDelete: 'cascade' }),
    name: text('name'),
    greeting: text('greeting'),
    createdAt,
    updatedAt,
  },
  (t) => ({
    orgUnique: uniqueIndex('assistants_org_uq').on(t.orgId),
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

export const jwks = pgTable('jwks', {
  id: id('jwk'),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
});

// Membership: which users belong to which orgs. Many-to-many — a user can
// be a member of multiple orgs (their personal org plus any team orgs
// they were invited to). `role` gates membership-management actions: only
// owners can invite, change roles, or remove members.
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
    // 'owner' | 'member'
    /** Which membership the dashboard's session-cookie path resolves to. */
    isDefault: boolean('is_default').notNull().default(false),
    createdAt,
  },
  (t) => ({
    pk: primaryKey({ columns: [t.orgId, t.userId] }),
    userIdx: index('org_members_user_idx').on(t.userId),
  }),
);

// Invitations: pending invites to join an org. Token is hashed at rest;
// the plaintext goes out in the invite email so the recipient can claim
// without proving prior knowledge of the org_id.
export const orgInvitations = pgTable(
  'org_invitations',
  {
    id: id('inv'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: varchar('role', { length: 32 }).notNull().default('member'),
    tokenHash: text('token_hash').notNull().unique(),
    invitedByUserId: text('invited_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedByUserId: text('accepted_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt,
  },
  (t) => ({
    orgIdx: index('org_invitations_org_idx').on(t.orgId),
    emailIdx: index('org_invitations_email_idx').on(t.orgId, t.email),
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
    description: text('description'),
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

export const oauthClient = pgTable(
  'oauth_client',
  {
    id: id('oclt'),
    clientId: text('client_id').notNull().unique(),
    clientSecret: text('client_secret'),
    disabled: boolean('disabled').notNull().default(false),
    skipConsent: boolean('skip_consent'),
    enableEndSession: boolean('enable_end_session'),
    subjectType: text('subject_type'),
    scopes: text('scopes').array(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    name: text('name'),
    uri: text('uri'),
    icon: text('icon'),
    contacts: text('contacts').array(),
    tos: text('tos'),
    policy: text('policy'),
    softwareId: text('software_id'),
    softwareVersion: text('software_version'),
    softwareStatement: text('software_statement'),
    redirectUris: text('redirect_uris').array().notNull(),
    postLogoutRedirectUris: text('post_logout_redirect_uris').array(),
    tokenEndpointAuthMethod: text('token_endpoint_auth_method'),
    grantTypes: text('grant_types').array(),
    responseTypes: text('response_types').array(),
    public: boolean('public'),
    type: text('type'),
    requirePKCE: boolean('require_pkce'),
    referenceId: text('reference_id'),
    metadata: jsonb('metadata'),
    createdAt,
    updatedAt,
  },
  (t) => ({
    userIdx: index('oauth_client_user_idx').on(t.userId),
  }),
);

export const oauthRefreshToken = pgTable(
  'oauth_refresh_token',
  {
    id: id('orft'),
    token: text('token').notNull(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
    sessionId: text('session_id').references(() => sessions.id, { onDelete: 'set null' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    referenceId: text('reference_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt,
    revoked: timestamp('revoked', { withTimezone: true }),
    authTime: timestamp('auth_time', { withTimezone: true }),
    scopes: text('scopes').array().notNull(),
  },
  (t) => ({
    clientIdx: index('oauth_refresh_token_client_idx').on(t.clientId),
    sessionIdx: index('oauth_refresh_token_session_idx').on(t.sessionId),
    userIdx: index('oauth_refresh_token_user_idx').on(t.userId),
  }),
);

export const oauthAccessToken = pgTable(
  'oauth_access_token',
  {
    id: id('oat'),
    token: text('token').notNull().unique(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
    sessionId: text('session_id').references(() => sessions.id, { onDelete: 'set null' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    referenceId: text('reference_id'),
    refreshId: text('refresh_id').references(() => oauthRefreshToken.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt,
    scopes: text('scopes').array().notNull(),
  },
  (t) => ({
    clientIdx: index('oauth_access_token_client_idx').on(t.clientId),
    sessionIdx: index('oauth_access_token_session_idx').on(t.sessionId),
    userIdx: index('oauth_access_token_user_idx').on(t.userId),
    refreshIdx: index('oauth_access_token_refresh_idx').on(t.refreshId),
  }),
);

export const oauthConsent = pgTable(
  'oauth_consent',
  {
    id: id('oco'),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    referenceId: text('reference_id'),
    scopes: text('scopes').array().notNull(),
    createdAt,
    updatedAt,
  },
  (t) => ({
    clientUserIdx: index('oauth_consent_client_user_idx').on(t.clientId, t.userId),
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

// Long-lived admin API keys.
export const apiKeys = pgTable(
  'api_keys',
  {
    id: id('akey'),
    orgId: text('org_id').references(() => orgs.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 32 }).notNull(), // 'admin'
    name: text('name').notNull(),
    keyHash: text('key_hash').notNull().unique(),
    keyPrefix: varchar('key_prefix', { length: 16 }).notNull(),
    scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
    audiences: jsonb('audiences').$type<string[]>().notNull().default(['admin']),
    // Optional channel binding — set on widget keys (mn_widget_*) so the
    // widget controller can resolve channel from the key. NULL on admin /
    // agent / delegate / partner keys.
    channelId: text('channel_id').references((): AnyPgColumn => convChannels.id, {
      onDelete: 'cascade',
    }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt,
  },
  (t) => ({
    orgIdx: index('api_keys_org_idx').on(t.orgId),
    prefixIdx: index('api_keys_prefix_idx').on(t.keyPrefix),
    channelIdx: index('api_keys_channel_idx').on(t.channelId),
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
    durationMs: integer('duration_ms'),
    userAgent: text('user_agent'),
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
// Soft locks: "actor X is working on entity Y for the next N minutes."
export const claims = pgTable(
  'claims',
  {
    id: id('clm'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    agentId: text('agent_id').references(() => agents.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    createdAt,
  },
  (t) => ({
    entityIdx: index('claims_entity_idx').on(t.orgId, t.entityType, t.entityId),
    expiresIdx: index('claims_expires_idx').on(t.expiresAt),
    userIdx: index('claims_user_idx').on(t.userId),
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
    slug: varchar('slug', { length: 64 }),
    title: text('title').notNull(),
    body: text('body').notNull(),
    audiences: jsonb('audiences')
      .$type<('admin' | 'self_service')[]>()
      .notNull()
      .default(['admin']),
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
    audiencesIdx: index('kb_documents_audiences_idx').using('gin', t.audiences),
    spaceSlugUq: uniqueIndex('kb_documents_space_slug_uq')
      .on(t.spaceId, t.slug)
      .where(sql`slug IS NOT NULL`),
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
    audiences: jsonb('audiences')
      .$type<('admin' | 'self_service')[]>()
      .notNull()
      .default(['admin']),
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

// ───────────────────────── Conversations (M3) ────────────────────────
// Multi-channel customer communications — both inbound (support / chat /
// inbound email) and outbound (proactive outreach by phone, email, SMS,
// or AI agent). Same primitives serve support and outreach equally well.

// Channels: where customers reach the org and where the org reaches out
// from. v0.4 ships email + a built-in "chat" channel for self-service;
// voice / sms come later.
export const convChannels = pgTable(
  'conv_channels',
  {
    id: id('cch'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 16 }).notNull(),
    // 'email' | 'voice' | 'chat' | 'sms'
    name: text('name').notNull(),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    active: boolean('active').notNull().default(true),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (t) => ({
    orgIdx: index('conv_channels_org_idx').on(t.orgId),
    typeIdx: index('conv_channels_type_idx').on(t.orgId, t.type),
  }),
);

// Topics: lightweight categorization (Billing, Support, Refunds, Outreach…).
// Slug-unique per org so agents can address them in conversation.
export const convTopics = pgTable(
  'conv_topics',
  {
    id: id('ctp'),
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
    orgIdx: index('conv_topics_org_idx').on(t.orgId),
    slugUq: uniqueIndex('conv_topics_org_slug_uq').on(t.orgId, t.slug),
  }),
);

// Contacts: conversation-specific view of a person. Links to EndUser when
// one exists (so the same human in CRM, conversations, and KB-self-service
// is visibly the same entity). For pre-EndUser flows (anonymous contact
// form, cold outreach to an unknown email, etc.) the FK is nullable so
// contacts can land first.
export const convContacts = pgTable(
  'conv_contacts',
  {
    id: id('ctc'),
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
    orgIdx: index('conv_contacts_org_idx').on(t.orgId),
    emailIdx: index('conv_contacts_email_idx').on(t.orgId, t.email),
    endUserIdx: index('conv_contacts_end_user_idx').on(t.endUserId),
  }),
);

// Conversations: the unit of work — a threaded exchange with one contact,
// inbound or outbound. Spans multiple channels in principle; in v0.4 a
// conversation is bound to one channel at creation but threading rules
// (M3+) can span channels via the same contact.
//
// `display_id` is per-org, allocated via the conv_next_display_id helper
// in conv.sql. The unique (org_id, display_id) index detects races; the
// service retries on conflict.
export const convConversations = pgTable(
  'conv_conversations',
  {
    id: id('ccv'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    displayId: integer('display_id').notNull(),
    channelId: text('channel_id')
      .notNull()
      .references(() => convChannels.id, { onDelete: 'restrict' }),
    contactId: text('contact_id').references(() => convContacts.id, { onDelete: 'set null' }),
    endUserId: text('end_user_id').references(() => endUsers.id, { onDelete: 'set null' }),
    topicId: text('topic_id').references(() => convTopics.id, { onDelete: 'set null' }),
    assigneeUserId: text('assignee_user_id').references(() => users.id, { onDelete: 'set null' }),
    subject: text('subject'),
    status: varchar('status', { length: 16 }).notNull().default('open'),
    // 'open' | 'snoozed' | 'closed' | 'spam'
    snoozeUntil: timestamp('snooze_until', { withTimezone: true }),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    needsHumanAttention: boolean('needs_human_attention').notNull().default(false),
    needsHumanAttentionAt: timestamp('needs_human_attention_at', { withTimezone: true }),
    runnerHolder: text('runner_holder'),
    runnerLeaseExpiresAt: timestamp('runner_lease_expires_at', { withTimezone: true }),
    outreachCampaignId: text('outreach_campaign_id').references(
      (): AnyPgColumn => outreachCampaigns.id,
      { onDelete: 'set null' },
    ),
    agentMode: varchar('agent_mode', { length: 16 }).notNull().default('auto'),
    // 'auto' | 'draft_only' | 'off'
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
    updatedAt,
  },
  (t) => ({
    orgIdx: index('conv_conversations_org_idx').on(t.orgId),
    statusIdx: index('conv_conversations_status_idx').on(t.orgId, t.status),
    endUserIdx: index('conv_conversations_end_user_idx').on(t.endUserId),
    contactIdx: index('conv_conversations_contact_idx').on(t.contactId),
    displayIdUq: uniqueIndex('conv_conversations_display_uq').on(t.orgId, t.displayId),
    lastMsgIdx: index('conv_conversations_last_msg_idx').on(t.orgId, t.lastMessageAt),
    needsAttentionIdx: index('conv_conversations_needs_attention_idx')
      .on(t.orgId, t.needsHumanAttentionAt)
      .where(sql`needs_human_attention = true`),
    outreachCampaignIdx: index('conv_conversations_outreach_campaign_idx').on(t.outreachCampaignId),
  }),
);

// Messages: posts inside a conversation. `internal=true` is staff-only
// (agent draft, side-comment); end-user audience never sees them. Author
// tags `(author_type, author_id)` so audit trails can name who said what.
export const convMessages = pgTable(
  'conv_messages',
  {
    id: id('cvm'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => convConversations.id, { onDelete: 'cascade' }),
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
    conversationIdx: index('conv_messages_conv_idx').on(t.conversationId, t.createdAt),
    orgIdx: index('conv_messages_org_idx').on(t.orgId),
  }),
);

// Outbound delivery bookkeeping for the email channel. One row per
// outbound message that needs to leave the building over SMTP.
// EmailOutboundWorker drains queued rows; updates with sent_at on
// success, bumps attempt + next_attempt_at on failure (5 attempts, then
// status='dead'). `message_id_header` is the RFC-822 Message-ID we
// stamped, used by inbound threading to chain replies back.
export const convMessageDeliveries = pgTable(
  'conv_message_deliveries',
  {
    id: id('cmd'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    messageId: text('message_id')
      .notNull()
      .references(() => convMessages.id, { onDelete: 'cascade' }),
    channelId: text('channel_id')
      .notNull()
      .references(() => convChannels.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 16 }).notNull().default('queued'),
    // 'queued' | 'sent' | 'failed' | 'dead'
    attempt: integer('attempt').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    error: text('error'),
    messageIdHeader: text('message_id_header'),
    inReplyToHeader: text('in_reply_to_header'),
    firstOpenedAt: timestamp('first_opened_at', { withTimezone: true }),
    lastOpenedAt: timestamp('last_opened_at', { withTimezone: true }),
    openCount: integer('open_count').notNull().default(0),
    createdAt,
    updatedAt,
  },
  (t) => ({
    drainIdx: index('conv_message_deliveries_drain_idx').on(t.status, t.nextAttemptAt),
    orgIdx: index('conv_message_deliveries_org_idx').on(t.orgId),
    msgIdx: index('conv_message_deliveries_msg_idx').on(t.messageId),
    msgIdHeaderIdx: index('conv_message_deliveries_msgid_idx').on(t.messageIdHeader),
  }),
);

// Per-end-user "this message was read" stamps. Chat-widget marks agent
// messages as read when they enter the viewport with the panel open; the
// dashboard surfaces these as "Seen at …" badges. One row per
// (message, end_user) — `ON CONFLICT DO NOTHING` on the unique index keeps
// re-emissions idempotent.
export const convMessageReads = pgTable(
  'conv_message_reads',
  {
    id: id('cmr'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => convConversations.id, { onDelete: 'cascade' }),
    messageId: text('message_id')
      .notNull()
      .references(() => convMessages.id, { onDelete: 'cascade' }),
    endUserId: text('end_user_id')
      .notNull()
      .references(() => endUsers.id, { onDelete: 'cascade' }),
    readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt,
  },
  (t) => ({
    uq: uniqueIndex('conv_message_reads_message_user_uq').on(t.messageId, t.endUserId),
    convIdx: index('conv_message_reads_conv_idx').on(t.orgId, t.conversationId),
    msgIdx: index('conv_message_reads_msg_idx').on(t.messageId),
  }),
);

// Ledger for widget→email fallback sends. When an agent message on a widget
// conversation is unread by the end-user for the fallback threshold, the
// sweeper claims a row here (unique on conversation_id + last_engagement_at,
// so at most one fallback fires per "quiet period"), composes a digest of
// all unread agent messages, and emails it. Replies thread back through
// `conv_message_deliveries.message_id_header` written by the sweeper.
export const convWidgetEmailFallbacks = pgTable(
  'conv_widget_email_fallbacks',
  {
    id: id('cwf'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => convConversations.id, { onDelete: 'cascade' }),
    endUserId: text('end_user_id')
      .notNull()
      .references(() => endUsers.id, { onDelete: 'cascade' }),
    emailChannelId: text('email_channel_id')
      .notNull()
      .references(() => convChannels.id, { onDelete: 'cascade' }),
    triggerMessageId: text('trigger_message_id')
      .notNull()
      .references(() => convMessages.id, { onDelete: 'cascade' }),
    lastEngagementAt: timestamp('last_engagement_at', { withTimezone: true }).notNull(),
    messageIdHeader: text('message_id_header'),
    messageCount: integer('message_count').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('queued'),
    // 'queued' | 'sent' | 'failed' | 'cancelled'
    error: text('error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (t) => ({
    convEngagementUq: uniqueIndex('conv_widget_email_fallbacks_conv_engagement_uq').on(
      t.conversationId,
      t.lastEngagementAt,
    ),
    orgIdx: index('conv_widget_email_fallbacks_org_idx').on(t.orgId),
    statusIdx: index('conv_widget_email_fallbacks_status_idx').on(t.status),
  }),
);

// One row per poll-mode channel for inbound bookkeeping. `cursor` is the
// adapter-specific high-water mark (email: { lastUid }; future SMS-poll
// or other adapters use whatever shape they need). RLS inherits from the
// parent channel via a sub-select policy (channels carry org_id).
export const convInboundState = pgTable('conv_inbound_state', {
  channelId: text('channel_id')
    .primaryKey()
    .references(() => convChannels.id, { onDelete: 'cascade' }),
  cursor: jsonb('cursor').$type<Record<string, unknown>>().notNull().default({}),
  lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt,
  updatedAt,
});

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
    consentLawfulBasis: varchar('consent_lawful_basis', { length: 32 }),
    consentGivenAt: timestamp('consent_given_at', { withTimezone: true }),
    consentSource: text('consent_source'),
    consentEvidence: jsonb('consent_evidence').$type<Record<string, unknown>>(),
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

export const crmSegments = pgTable(
  'crm_segments',
  {
    id: id('cseg'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    filterDefinition: jsonb('filter_definition')
      .$type<{
        tagsAny?: string[];
        tagsAll?: string[];
        companyId?: string;
        searchQuery?: string;
        contactedSince?: string;
      }>()
      .notNull()
      .default({}),
    createdByActorType: varchar('created_by_actor_type', { length: 16 }).notNull(),
    createdByActorId: text('created_by_actor_id').notNull(),
    createdAt,
    updatedAt,
  },
  (t) => ({
    orgIdx: index('crm_segments_org_idx').on(t.orgId),
    nameUq: uniqueIndex('crm_segments_org_name_uq').on(t.orgId, t.name),
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

// Merge proposals: structured "these two contacts look like the same
// person, here's the recommended resolution" rows filed by the CRM
// hygiene curator (or a human spot-checker). Operator reviews via
// `crm_list_merge_proposals` and resolves with `crm_apply_merge_proposal`
// or `crm_dismiss_merge_proposal`. Pair canonicalization (sorted ids) +
// the partial unique index make repeated curator passes idempotent on
// pending pairs without needing UPSERT semantics in the migration.
export const crmMergeProposals = pgTable(
  'crm_merge_proposals',
  {
    id: id('cmp'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    contactAId: text('contact_a_id')
      .notNull()
      .references(() => crmContacts.id, { onDelete: 'cascade' }),
    contactBId: text('contact_b_id')
      .notNull()
      .references(() => crmContacts.id, { onDelete: 'cascade' }),
    confidence: varchar('confidence', { length: 8 }).notNull(),
    // 'high' | 'medium'
    evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull().default({}),
    recommendedKeeperId: text('recommended_keeper_id').notNull(),
    recommendedPatch: jsonb('recommended_patch').$type<Record<string, unknown>>().notNull().default({}),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    // 'pending' | 'applied' | 'dismissed'
    dismissReason: text('dismiss_reason'),
    proposedByActorType: varchar('proposed_by_actor_type', { length: 16 }).notNull(),
    proposedByActorId: text('proposed_by_actor_id').notNull(),
    decidedByActorType: varchar('decided_by_actor_type', { length: 16 }),
    decidedByActorId: text('decided_by_actor_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (t) => ({
    orgStatusIdx: index('crm_merge_proposals_org_status_idx').on(t.orgId, t.status),
    contactAIdx: index('crm_merge_proposals_contact_a_idx').on(t.contactAId),
    contactBIdx: index('crm_merge_proposals_contact_b_idx').on(t.contactBId),
    pendingPairUq: uniqueIndex('crm_merge_proposals_pending_pair_uq')
      .on(t.orgId, t.contactAId, t.contactBId)
      .where(sql`status = 'pending'`),
  }),
);

// ───────────────────────── CMS (M6) ───────────────────────────────────
// Headless CMS — schema-on-write: orgs define collections (with custom
// fields) and store entries as JSON keyed by field name. Public delivery
// API serves status='published' rows anonymously through a service-role
// controller; admin MCP tools author drafts, publish, schedule, version.

// Collections: a content type. `fields` is an array of FieldDef objects;
// the service projects entries' jsonb data through this on read.
export const cmsCollections = pgTable(
  'cms_collections',
  {
    id: id('cmc'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: varchar('slug', { length: 64 }).notNull(),
    description: text('description'),
    fields: jsonb('fields').$type<unknown[]>().notNull().default([]),
    localized: boolean('localized').notNull().default(false),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
    updatedAt,
  },
  (t) => ({
    orgIdx: index('cms_collections_org_idx').on(t.orgId),
    slugUq: uniqueIndex('cms_collections_slug_uq').on(t.orgId, t.slug),
  }),
);

// Entries: one row per (collection, slug, locale). `data` jsonb stores
// the user payload keyed by collection field names. `search_text` is a
// flattened concat of searchable fields (populated by CmsService on
// every write); `fts` (added in cms.sql) is a generated tsvector over
// it; `embedding` is the vector for hybrid search.
export const cmsEntries = pgTable(
  'cms_entries',
  {
    id: id('cme'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    collectionId: text('collection_id')
      .notNull()
      .references(() => cmsCollections.id, { onDelete: 'cascade' }),
    slug: varchar('slug', { length: 200 }).notNull(),
    locale: varchar('locale', { length: 16 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('draft'),
    // 'draft' | 'published' | 'scheduled' | 'archived'
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    version: integer('version').notNull().default(1),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    searchText: text('search_text').notNull().default(''),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdByType: varchar('created_by_type', { length: 16 }).notNull(),
    createdById: text('created_by_id').notNull(),
    updatedByType: varchar('updated_by_type', { length: 16 }).notNull(),
    updatedById: text('updated_by_id').notNull(),
    createdAt,
    updatedAt,
  },
  (t) => ({
    orgIdx: index('cms_entries_org_idx').on(t.orgId),
    collectionIdx: index('cms_entries_collection_idx').on(t.collectionId),
    statusIdx: index('cms_entries_status_idx').on(t.orgId, t.status),
    deliveryIdx: index('cms_entries_delivery_idx').on(
      t.orgId,
      t.collectionId,
      t.status,
      t.locale,
    ),
    scheduledIdx: index('cms_entries_scheduled_idx').on(t.scheduledAt),
    slugUq: uniqueIndex('cms_entries_slug_uq').on(t.orgId, t.collectionId, t.slug, t.locale),
  }),
);

// Immutable history snapshots — same pattern as kb_document_versions.
export const cmsEntryVersions = pgTable(
  'cms_entry_versions',
  {
    id: id('cev'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    entryId: text('entry_id')
      .notNull()
      .references(() => cmsEntries.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdByType: varchar('created_by_type', { length: 16 }).notNull(),
    createdById: text('created_by_id').notNull(),
    createdAt,
  },
  (t) => ({
    versionUq: uniqueIndex('cms_versions_entry_version_uq').on(t.entryId, t.version),
    orgIdx: index('cms_versions_org_idx').on(t.orgId),
  }),
);

// Assets: media library. Storage backend (local|s3) + key + publicly-
// accessible URL. CmsService mints the storage_key; the actual upload
// happens out-of-band via a presigned PUT URL (S3) or a POST handler
// (LocalFs) that backs onto the static-assets controller.
export const cmsAssets = pgTable(
  'cms_assets',
  {
    id: id('cma'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
    storageProvider: varchar('storage_provider', { length: 16 }).notNull(),
    // 'local' | 's3'
    storageKey: text('storage_key').notNull(),
    publicUrl: text('public_url').notNull(),
    altText: text('alt_text'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    /** Set true once the upload is confirmed; pending rows are GC-eligible. */
    uploaded: boolean('uploaded').notNull().default(false),
    createdByType: varchar('created_by_type', { length: 16 }).notNull(),
    createdById: text('created_by_id').notNull(),
    createdAt,
    updatedAt,
  },
  (t) => ({
    orgIdx: index('cms_assets_org_idx').on(t.orgId),
    keyUq: uniqueIndex('cms_assets_key_uq').on(t.storageKey),
  }),
);

// Locales: per-org list. is_default flags the org's fallback locale.
export const cmsLocales = pgTable(
  'cms_locales',
  {
    id: id('cml'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    code: varchar('code', { length: 16 }).notNull(),
    name: text('name').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    position: integer('position').notNull().default(0),
    createdAt,
  },
  (t) => ({
    codeUq: uniqueIndex('cms_locales_code_uq').on(t.orgId, t.code),
  }),
);

// References: materialize "entry A links to entry B" edges so "what
// links to this entry" + ?include=author,company joins are cheap. The
// service rewrites this whenever an entry's data changes.
export const cmsReferences = pgTable(
  'cms_references',
  {
    id: id('cmr'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    fromEntryId: text('from_entry_id')
      .notNull()
      .references(() => cmsEntries.id, { onDelete: 'cascade' }),
    toEntryId: text('to_entry_id')
      .notNull()
      .references(() => cmsEntries.id, { onDelete: 'cascade' }),
    fieldName: varchar('field_name', { length: 64 }).notNull(),
    position: integer('position').notNull().default(0),
    createdAt,
  },
  (t) => ({
    fromIdx: index('cms_references_from_idx').on(t.fromEntryId),
    toIdx: index('cms_references_to_idx').on(t.toEntryId),
  }),
);

// ───────────────────────────── Curator jobs ──────────────────────────
// Persistent queue for curator background jobs. The bundled in-process
// runner (or any admin-authenticated runner) claims pending rows via
// SELECT … FOR UPDATE SKIP LOCKED, runs the job, and acks/fails.
// `job_uri` is the dispatch key — `skill://...` for LLM-driven
// markdown skills, `task://...` for code-defined deterministic tasks.
export const curatorJobs = pgTable(
  'curator_jobs',
  {
    id: id('cjob'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    jobUri: text('job_uri').notNull(),
    userPrompt: text('user_prompt').notNull(),
    sourceEventType: text('source_event_type'),
    sourceEventPayload: jsonb('source_event_payload'),
    dedupeKey: text('dedupe_key'),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    leaseHolder: text('lease_holder'),
    lastError: text('last_error'),
    lastReplyText: text('last_reply_text'),
    lastToolCalls: integer('last_tool_calls'),
    lastTotalTokens: integer('last_total_tokens'),
    createdAt,
    updatedAt,
    doneAt: timestamp('done_at', { withTimezone: true }),
  },
  (t) => ({
    orgStatusIdx: index('curator_jobs_org_status_idx').on(t.orgId, t.status),
    pendingIdx: index('curator_jobs_pending_idx').on(t.nextAttemptAt),
    dedupeUq: uniqueIndex('curator_jobs_dedupe_uq')
      .on(t.orgId, t.dedupeKey)
      .where(sql`dedupe_key IS NOT NULL AND status = 'pending'`),
  }),
);

// ─────────────────────────────── Outreach ────────────────────────────
// Operator-defined campaigns (segment + brief + email channel + cadence)
// and the per-contact proposal queue. The contact-extract / hygiene
// curators pre-populate `crm_contacts`; the outreach curator drafts
// initials per (campaign, contact) → review → approve → send via the
// existing email channel. Replies thread into normal conversations
// (reply attribution via `conv_conversations.outreach_campaign_id`).
export const outreachCampaigns = pgTable(
  'outreach_campaigns',
  {
    id: id('ocmp'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    brief: text('brief').notNull(),
    segmentId: text('segment_id')
      .notNull()
      .references(() => crmSegments.id, { onDelete: 'restrict' }),
    channelId: text('channel_id')
      .notNull()
      .references(() => convChannels.id, { onDelete: 'restrict' }),
    cadenceRules: jsonb('cadence_rules')
      .$type<{
        maxPerWeekPerContact?: number;
        quietHoursStart?: string;
        quietHoursEnd?: string;
        blackoutDates?: string[];
      }>()
      .notNull()
      .default({}),
    ctaUrl: text('cta_url'),
    enabled: boolean('enabled').notNull().default(false),
    unsubscribeRequired: boolean('unsubscribe_required').notNull().default(true),
    createdByActorType: varchar('created_by_actor_type', { length: 16 }).notNull(),
    createdByActorId: text('created_by_actor_id').notNull(),
    createdAt,
    updatedAt,
  },
  (t) => ({
    orgIdx: index('outreach_campaigns_org_idx').on(t.orgId),
    nameUq: uniqueIndex('outreach_campaigns_org_name_uq').on(t.orgId, t.name),
    enabledIdx: index('outreach_campaigns_enabled_idx')
      .on(t.orgId, t.enabled)
      .where(sql`enabled = true`),
  }),
);

export const outreachProposals = pgTable(
  'outreach_proposals',
  {
    id: id('oprp'),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => outreachCampaigns.id, { onDelete: 'cascade' }),
    contactId: text('contact_id')
      .notNull()
      .references(() => crmContacts.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id').references(() => convConversations.id, {
      onDelete: 'set null',
    }),
    kind: varchar('kind', { length: 16 }).notNull(),
    // 'initial' | 'reply'
    draftSubject: text('draft_subject'),
    draftBody: text('draft_body').notNull(),
    evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull().default({}),
    proposedSendAt: timestamp('proposed_send_at', { withTimezone: true }),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    // 'pending' | 'approved' | 'sent' | 'failed' | 'dismissed'
    proposedByActorType: varchar('proposed_by_actor_type', { length: 16 }).notNull(),
    proposedByActorId: text('proposed_by_actor_id').notNull(),
    decidedByActorType: varchar('decided_by_actor_type', { length: 16 }),
    decidedByActorId: text('decided_by_actor_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    sentMessageId: text('sent_message_id').references(() => convMessages.id, {
      onDelete: 'set null',
    }),
    failureReason: text('failure_reason'),
    dismissReason: text('dismiss_reason'),
    createdAt,
    updatedAt,
  },
  (t) => ({
    orgStatusIdx: index('outreach_proposals_org_status_idx').on(t.orgId, t.status),
    campaignIdx: index('outreach_proposals_campaign_idx').on(t.campaignId),
    contactIdx: index('outreach_proposals_contact_idx').on(t.contactId),
    conversationIdx: index('outreach_proposals_conversation_idx').on(t.conversationId),
    pendingPairUq: uniqueIndex('outreach_proposals_pending_pair_uq')
      .on(t.campaignId, t.contactId, t.kind)
      .where(sql`status = 'pending'`),
  }),
);

// All the tables exported as a single namespace for convenience:
export const allTables = {
  orgs,
  users,
  sessions,
  accounts,
  verifications,
  orgMembers,
  orgInvitations,
  endUsers,
  agents,
  oauthClients,
  oauthClient,
  oauthAccessToken,
  oauthRefreshToken,
  oauthConsent,
  jwks,
  tokens,
  apiKeys,
  auditLog,
  events,
  claims,
  webhooks,
  webhookDeliveries,
  bootstrapState,
  rateLimitCounters,
  kbSpaces,
  kbDocuments,
  kbDocumentChunks,
  kbDocumentVersions,
  convChannels,
  convTopics,
  convContacts,
  convConversations,
  convMessages,
  convMessageDeliveries,
  convMessageReads,
  convWidgetEmailFallbacks,
  convInboundState,
  crmCompanies,
  crmContacts,
  crmPipelines,
  crmStages,
  crmDeals,
  crmActivities,
  crmRelationships,
  crmMergeProposals,
  crmSegments,
  outreachCampaigns,
  outreachProposals,
  cmsCollections,
  cmsEntries,
  cmsEntryVersions,
  cmsAssets,
  cmsLocales,
  cmsReferences,
  curatorJobs,
};

export type AllTables = typeof allTables;
export { sql };
