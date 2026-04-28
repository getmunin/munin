/**
 * @munin/core — framework-agnostic platform services.
 *
 * Everything here is plain TypeScript / Drizzle. NestJS-specific wrappers
 * (interceptors, guards, modules) live in apps/backend/src/common/.
 */

export {
  ActorIdentity,
  type ActorType,
  type Audience,
  type RequestContext,
  RequestContextStore,
  getCurrentContext,
  withContext,
} from './context.js';

export { hashSecret, randomToken, signHmac, verifyHmac, timingSafeEqual } from './crypto.js';
export { AuditLogger, type AuditEventInput } from './audit.js';
export { ClaimManager, type ClaimResult } from './claims.js';
export { WebhookDispatcher, type WebhookEventInput } from './webhooks.js';
export { CredentialResolver, type ResolvedCredential } from './credentials.js';
