export {
  ActorIdentity,
  type ActorType,
  type Audience,
  type RequestContext,
  RequestContextStore,
  getCurrentContext,
  withContext,
} from './request/context.js';
export {
  buildAdminAgentActor,
  buildEndUserAgentActor,
  type EndUserAgentActorInput,
} from './request/synth-agent-actor.js';
export { AuditLogger, type AuditEventInput } from './request/audit.js';
export { ClaimManager, type ClaimResult } from './request/claims.js';
export { CredentialResolver, type ResolvedCredential } from './request/credentials.js';

export {
  hashSecret,
  randomToken,
  signHmac,
  verifyHmac,
  timingSafeEqual,
  readEncryptionKey,
  setEncryptionKeySql,
  encryptSecretSql,
  decryptSecretSql,
} from './crypto/primitives.js';
export { buildApiKey, keyPrefix, isWellFormedKey, type KeyKind } from './crypto/keys.js';
export {
  type UnsubscribeTokenPayload,
  UnsubscribeTokenError,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from './crypto/outreach-tokens.js';
export {
  type EmailOpenTokenPayload,
  EmailOpenTokenError,
  signEmailOpenToken,
  verifyEmailOpenToken,
} from './crypto/email-open-token.js';

export {
  type EmbeddingProvider,
  OpenAIEmbeddingProvider,
  StubEmbeddingProvider,
  readEmbeddingProviderFromEnv,
} from './providers/embedding.js';
export {
  type Mailer,
  type MailMessage,
  type SentMessage,
  ResendMailer,
  StubMailer,
  readMailerFromEnv,
} from './providers/mailer.js';
export {
  type AssetStorage,
  type LocalFsStorageOptions,
  type S3CompatibleStorageOptions,
  LocalFsStorage,
  S3CompatibleStorage,
  readAssetStorageFromEnv,
} from './providers/storage.js';

export { WebhookDispatcher, type WebhookEventInput } from './webhooks.js';
export {
  chunkDocument,
  estimateTokens,
  contentHash,
  type Chunk,
  type ChunkOptions,
} from './chunker.js';

export {
  AGENT_RUNTIME_PROMPT_SPACE_SLUG,
  COMPANY_PROFILE_SPACE_SLUG,
  SYSTEM_PROMPT_SLUG,
  CHANNEL_PROMPT_PREFIX,
  CHANNEL_CHAT_SLUG,
  CHANNEL_EMAIL_SLUG,
  CHANNEL_SMS_SLUG,
  CHANNEL_DEFAULT_SLUG,
  COMPANY_PROFILE_SLUG,
  VOICE_SYSTEM_PROMPT_SLUG,
  VOICE_OPENER_COLD_SLUG,
  VOICE_OPENER_CONTINUATION_SLUG,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_CHANNEL_CHAT_PROMPT,
  DEFAULT_CHANNEL_EMAIL_PROMPT,
  DEFAULT_CHANNEL_SMS_PROMPT,
  DEFAULT_CHANNEL_DEFAULT_PROMPT,
  DEFAULT_VOICE_SYSTEM_PROMPT,
  DEFAULT_VOICE_OPENER_COLD,
  DEFAULT_VOICE_OPENER_CONTINUATION,
  SEEDABLE_PROMPTS,
  type SeedablePrompt,
  getSeedablePrompt,
  type KbDocLocation,
  type KbDocReader,
  type PromptCache,
  type PromptCacheEntry,
  type PromptCacheOptions,
  createPromptCache,
} from './prompts/index.js';
