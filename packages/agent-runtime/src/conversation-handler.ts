import { auditReply } from './audit.js';
import { runAgent } from './runtime.js';
import type {
  ConversationMessage,
  McpToolHandle,
  Provider,
} from './types.js';
import type { PromptResolver } from './prompt-resolver.js';
import type { ConversationDetail, MuninRestClient } from './munin-rest.js';

export interface HandlerConfig {
  providerBaseUrl: string;
  providerApiKey: string;
  model: string;
  maxToolIterations: number;
  maxHistoryChars: number;
  debounceMs: number;
  auditEnabled?: boolean;
  auditModel?: string;
}

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;
const HANDOVER_TOOL_NAME = 'conv_request_handover_in_my_conversation';
const TOKEN_REFRESH_MARGIN_MS = 60_000;

export interface OpenedMcp extends McpToolHandle {
  close(): Promise<void>;
}

export interface ConversationHandlerDeps {
  config: HandlerConfig;
  rest: MuninRestClient;
  prompts: PromptResolver;
  openMcp: (opts: { delegatedToken: string }) => Promise<OpenedMcp>;
  logger?: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  scheduler?: {
    delay: (ms: number, signal: AbortSignal) => Promise<void>;
  };
  provider?: Provider;
}

export interface IncomingMessage {
  conversationId: string;
  authorType: 'user' | 'agent' | 'end_user' | 'system';
}

interface InFlight {
  controller: AbortController;
  promise: Promise<void>;
}

export interface ConversationHandler {
  handle(event: IncomingMessage): void;
  /** Wait for all in-flight runs to finish (used by tests). */
  flush(): Promise<void>;
}

export function createConversationHandler(deps: ConversationHandlerDeps): ConversationHandler {
  const log = deps.logger ?? {
    info: (m) => console.log(`[handler] ${m}`),
    warn: (m) => console.warn(`[handler] ${m}`),
    error: (m) => console.error(`[handler] ${m}`),
  };
  const scheduler = deps.scheduler ?? defaultScheduler;
  const inFlight = new Map<string, InFlight>();
  const tokenCache = new Map<string, { accessToken: string; expiresAtMs: number }>();

  async function getDelegatedToken(endUserId: string): Promise<string> {
    const now = Date.now();
    const cached = tokenCache.get(endUserId);
    if (cached && cached.expiresAtMs - now > TOKEN_REFRESH_MARGIN_MS) {
      return cached.accessToken;
    }
    const minted = await deps.rest.mintDelegatedToken(endUserId);
    tokenCache.set(endUserId, {
      accessToken: minted.accessToken,
      expiresAtMs: Date.parse(minted.expiresAt),
    });
    return minted.accessToken;
  }

  function shouldRespond(detail: ConversationDetail): boolean {
    if (detail.status !== 'open') {
      log.info(`skip ${detail.id}: status=${detail.status}`);
      return false;
    }
    if (detail.assigneeUserId) {
      log.info(`skip ${detail.id}: assigned to staff ${detail.assigneeUserId}`);
      return false;
    }
    if (!detail.endUserId) {
      log.info(`skip ${detail.id}: no end-user bound`);
      return false;
    }
    const last = lastInbound(detail);
    if (!last) {
      log.info(`skip ${detail.id}: no inbound message yet`);
      return false;
    }
    return true;
  }

  async function run(conversationId: string, signal: AbortSignal): Promise<void> {
    try {
      await scheduler.delay(deps.config.debounceMs, signal);
    } catch {
      return;
    }
    if (signal.aborted) return;

    const detail = await deps.rest.getConversation(conversationId);
    if (!shouldRespond(detail)) return;
    if (signal.aborted) return;

    const history = deps.rest.toRuntimeHistory(detail);
    const endUserId = detail.endUserId!;
    const baseSystem = deps.prompts.system();
    const channelDescriptor = detail.channelType
      ? deps.prompts.channel(detail.channelType)
      : '';
    const systemPrompt = channelDescriptor
      ? `${baseSystem}\n\n${channelDescriptor}`
      : baseSystem;

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      if (signal.aborted) return;
      const accessToken = await getDelegatedToken(endUserId);
      const mcp = await deps.openMcp({ delegatedToken: accessToken });
      try {
        const reply = await runAgent({
          config: {
            provider: {
              baseUrl: deps.config.providerBaseUrl,
              apiKey: deps.config.providerApiKey,
            },
            model: deps.config.model,
            systemPrompt,
            maxToolIterations: deps.config.maxToolIterations,
            maxHistoryChars: deps.config.maxHistoryChars,
          },
          history,
          mcp,
          abortSignal: signal,
          provider: deps.provider,
        });

        if (reply.body.trim().length > 0) {
          await maybeForceHandover({
            conversationId,
            reply,
            history,
            mcp,
            log,
          });
          await deps.rest.postAgentMessage(conversationId, reply.body);
          log.info(
            `${conversationId} replied (model=${reply.model}, tools=${reply.toolCalls.length}, tokens=${reply.usage.totalTokens})`,
          );
          return;
        }
        log.warn(`${conversationId} produced empty body (finishReason=${reply.finishReason})`);
        // Empty body is treated like an error → retry.
        lastError = new Error(`empty reply (finishReason=${reply.finishReason})`);
      } catch (err) {
        if (signal.aborted) return;
        lastError = err instanceof Error ? err : new Error(String(err));
        log.warn(`${conversationId} attempt ${attempt + 1} failed: ${lastError.message}`);
      } finally {
        await mcp.close().catch(() => undefined);
      }

      if (attempt + 1 < MAX_RETRIES) {
        const backoff = RETRY_BASE_MS * 2 ** attempt;
        try {
          await scheduler.delay(backoff, signal);
        } catch {
          return;
        }
      }
    }

    log.error(
      `${conversationId} exhausted retries (${lastError?.message ?? 'unknown'}); requesting human handover`,
    );
    await requestHandover(conversationId, endUserId).catch((err) => {
      log.error(
        `${conversationId} handover request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  async function maybeForceHandover(args: {
    conversationId: string;
    reply: { body: string; toolCalls: { name: string }[] };
    history: ConversationMessage[];
    mcp: McpToolHandle;
    log: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
  }): Promise<void> {
    if (deps.config.auditEnabled === false) return;
    if (
      args.reply.toolCalls.some((t) => t.name === HANDOVER_TOOL_NAME)
    ) {
      return;
    }
    const lastUser = [...args.history].reverse().find(
      (m) => m.authorType === 'user' || m.authorType === 'end_user',
    );
    if (!lastUser) return;
    const verdict = await auditReply({
      provider: {
        baseUrl: deps.config.providerBaseUrl,
        apiKey: deps.config.providerApiKey,
      },
      model: deps.config.auditModel ?? deps.config.model,
      question: lastUser.body,
      reply: args.reply.body,
      toolNames: args.reply.toolCalls.map((t) => t.name),
      providerImpl: deps.provider,
    });
    if (!verdict.handover) return;
    args.log.warn(
      `${args.conversationId} audit force-handover (${verdict.reason || 'no reason'})`,
    );
    try {
      await args.mcp.callTool(HANDOVER_TOOL_NAME, {
        conversationId: args.conversationId,
        reason: verdict.reason || 'audit detected deferral without handover call',
      });
    } catch (err) {
      args.log.error(
        `${args.conversationId} audit handover call failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async function requestHandover(conversationId: string, endUserId: string): Promise<void> {
    const accessToken = await getDelegatedToken(endUserId);
    const mcp = await deps.openMcp({ delegatedToken: accessToken });
    try {
      await mcp.callTool(HANDOVER_TOOL_NAME, { conversationId });
    } finally {
      await mcp.close().catch(() => undefined);
    }
  }

  return {
    handle(event: IncomingMessage): void {
      if (event.authorType !== 'user' && event.authorType !== 'end_user') return;

      const existing = inFlight.get(event.conversationId);
      if (existing) {
        existing.controller.abort();
      }
      const controller = new AbortController();
      const promise = run(event.conversationId, controller.signal)
        .catch((err) => {
          log.error(
            `${event.conversationId} unhandled: ${err instanceof Error ? err.message : String(err)}`,
          );
        })
        .finally(() => {
          if (inFlight.get(event.conversationId)?.controller === controller) {
            inFlight.delete(event.conversationId);
          }
        });
      inFlight.set(event.conversationId, { controller, promise });
    },
    async flush(): Promise<void> {
      await Promise.all([...inFlight.values()].map((f) => f.promise));
    },
  };
}

function lastInbound(detail: ConversationDetail): ConversationMessage | null {
  for (let i = detail.messages.length - 1; i >= 0; i -= 1) {
    const m = detail.messages[i];
    if (!m) continue;
    if (m.authorType === 'user' || m.authorType === 'end_user') {
      return { authorType: m.authorType, body: m.body, createdAt: m.createdAt };
    }
  }
  return null;
}

const defaultScheduler = {
  delay(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException('aborted', 'AbortError'));
        return;
      }
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(new DOMException('aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  },
};
