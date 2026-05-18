import {
  AGENT_RUNTIME_PROMPT_SPACE_SLUG,
  CHANNEL_DEFAULT_SLUG,
  CHANNEL_PROMPT_PREFIX,
  COMPANY_PROFILE_SLUG,
  COMPANY_PROFILE_SPACE_SLUG,
  SEEDABLE_PROMPTS,
  SYSTEM_PROMPT_SLUG,
  VOICE_OPENER_COLD_SLUG,
  VOICE_OPENER_CONTINUATION_SLUG,
  VOICE_SYSTEM_PROMPT_SLUG,
  createPromptCache,
  type KbDocLocation,
  type KbDocReader,
  type PromptCache,
  type PromptCacheEntry,
  type SeedablePrompt,
} from '@getmunin/core';
import type { McpToolHandle, McpToolResult } from './types.js';

export {
  AGENT_RUNTIME_PROMPT_SPACE_SLUG as PROMPT_SPACE_SLUG,
  SYSTEM_PROMPT_SLUG,
  CHANNEL_PROMPT_PREFIX,
  COMPANY_PROFILE_SLUG,
  COMPANY_PROFILE_SPACE_SLUG,
  VOICE_SYSTEM_PROMPT_SLUG,
  VOICE_OPENER_COLD_SLUG,
  VOICE_OPENER_CONTINUATION_SLUG,
};

export interface PromptResolver {
  system(): string;
  channel(kind: string): string;
  companyContext(): string;
  voiceSystem(): string;
  voiceOpener(hasPriorAgentTurn: boolean): string;
  isPromptDocument(slug: string | null | undefined): boolean;
  refresh(slug: string): Promise<void>;
  refreshAll(): Promise<void>;
  close(): Promise<void>;
}

export interface CreatePromptResolverOptions {
  mcp: McpToolHandle;
  logger?: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
}

export async function createPromptResolver(
  opts: CreatePromptResolverOptions,
): Promise<PromptResolver> {
  const log = opts.logger ?? {
    info: (m) => console.log(`[prompts] ${m}`),
    warn: (m) => console.warn(`[prompts] ${m}`),
    error: (m) => console.error(`[prompts] ${m}`),
  };

  await ensureSpace(opts.mcp, AGENT_RUNTIME_PROMPT_SPACE_SLUG, log);
  for (const seed of SEEDABLE_PROMPTS) {
    await ensureDocument(opts.mcp, seed, log);
  }

  const entries: Record<string, PromptCacheEntry> = {};
  for (const seed of SEEDABLE_PROMPTS) {
    entries[seed.slug] = {
      location: { spaceSlug: AGENT_RUNTIME_PROMPT_SPACE_SLUG, slug: seed.slug },
      fallback: seed.body,
    };
  }
  entries[COMPANY_PROFILE_SLUG] = {
    location: { spaceSlug: COMPANY_PROFILE_SPACE_SLUG, slug: COMPANY_PROFILE_SLUG },
    fallback: '',
  };

  const reader = new McpKbDocReader(opts.mcp);
  const cache = await createPromptCache({ reader, entries, logger: log });

  const KNOWN_EXACT_SLUGS = new Set<string>([
    SYSTEM_PROMPT_SLUG,
    COMPANY_PROFILE_SLUG,
    VOICE_SYSTEM_PROMPT_SLUG,
    VOICE_OPENER_COLD_SLUG,
    VOICE_OPENER_CONTINUATION_SLUG,
  ]);

  function isPromptSlug(slug: string | null | undefined): boolean {
    if (!slug) return false;
    if (KNOWN_EXACT_SLUGS.has(slug)) return true;
    return slug.startsWith(CHANNEL_PROMPT_PREFIX);
  }

  return {
    system(): string {
      return cache.get(SYSTEM_PROMPT_SLUG);
    },
    channel(kind: string): string {
      const slug = `${CHANNEL_PROMPT_PREFIX}${kind}`;
      if (cache.has(slug)) return cache.get(slug);
      return cache.get(CHANNEL_DEFAULT_SLUG);
    },
    companyContext(): string {
      return cache.get(COMPANY_PROFILE_SLUG);
    },
    voiceSystem(): string {
      return cache.get(VOICE_SYSTEM_PROMPT_SLUG);
    },
    voiceOpener(hasPriorAgentTurn: boolean): string {
      return cache.get(
        hasPriorAgentTurn ? VOICE_OPENER_CONTINUATION_SLUG : VOICE_OPENER_COLD_SLUG,
      );
    },
    isPromptDocument(slug): boolean {
      return isPromptSlug(slug);
    },
    refresh: (slug) => cache.refresh(slug),
    refreshAll: () => cache.refreshAll(),
    async close(): Promise<void> {
      // Owned by the caller; close the mcp from main.ts.
    },
  };
}

class McpKbDocReader implements KbDocReader {
  constructor(private readonly mcp: McpToolHandle) {}

  async getBody(location: KbDocLocation): Promise<string | null> {
    const result = await this.mcp.callTool('kb_get_document_by_slug', {
      spaceSlug: location.spaceSlug,
      slug: location.slug,
    });
    return parseDocumentBody(result);
  }
}

async function ensureSpace(
  mcp: McpToolHandle,
  spaceSlug: string,
  log: { info: (m: string) => void; warn: (m: string) => void },
): Promise<void> {
  try {
    await mcp.callTool('kb_create_space', {
      name: 'Agent runtime',
      slug: spaceSlug,
      description:
        'Self-service AI runtime configuration. Edit the system prompt and per-channel descriptors here; the runner picks up changes within a few seconds via realtime events.',
    });
    log.info(`created KB space ${spaceSlug}`);
  } catch (err) {
    if (looksLikeConflict(err)) return;
    throw err;
  }
}

async function ensureDocument(
  mcp: McpToolHandle,
  seed: SeedablePrompt,
  log: { info: (m: string) => void; warn: (m: string) => void },
): Promise<void> {
  const existing = await readBySlug(mcp, AGENT_RUNTIME_PROMPT_SPACE_SLUG, seed.slug);
  if (existing !== null) return;
  const spaceId = await getSpaceId(mcp, AGENT_RUNTIME_PROMPT_SPACE_SLUG);
  await mcp.callTool('kb_create_document', {
    spaceId,
    slug: seed.slug,
    title: seed.title,
    body: seed.body,
    audiences: ['admin'],
  });
  log.info(`seeded KB doc ${AGENT_RUNTIME_PROMPT_SPACE_SLUG}/${seed.slug} from defaults`);
}

async function readBySlug(
  mcp: McpToolHandle,
  spaceSlug: string,
  slug: string,
): Promise<string | null> {
  const result = await mcp.callTool('kb_get_document_by_slug', { spaceSlug, slug });
  return parseDocumentBody(result);
}

async function getSpaceId(mcp: McpToolHandle, spaceSlug: string): Promise<string> {
  const result = await mcp.callTool('kb_list_spaces', {});
  const text = textFromResult(result);
  if (!text) throw new Error('kb_list_spaces returned no content');
  const parsed = JSON.parse(text) as Array<{ id: string; slug: string }>;
  const space = parsed.find((s) => s.slug === spaceSlug);
  if (!space) throw new Error(`KB space ${spaceSlug} not found after ensureSpace`);
  return space.id;
}

function parseDocumentBody(result: McpToolResult): string | null {
  if (result.isError) return null;
  const text = textFromResult(result);
  if (!text || text === 'null') return null;
  try {
    const parsed = JSON.parse(text) as { body?: string } | null;
    return parsed?.body ?? null;
  } catch {
    return null;
  }
}

function textFromResult(result: McpToolResult): string {
  for (const item of result.content) {
    if (item.type === 'text' && typeof (item as { text?: unknown }).text === 'string') {
      return (item as { text: string }).text;
    }
  }
  return '';
}

function looksLikeConflict(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const msg = 'message' in err && typeof err.message === 'string'
    ? err.message.toLowerCase()
    : '';
  return msg.includes('conflict') || msg.includes('already');
}
