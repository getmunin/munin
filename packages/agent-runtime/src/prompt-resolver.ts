import { readFile, readdir } from 'node:fs/promises';
import { resolve, basename, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { McpToolHandle, McpToolResult } from './types.js';

export const PROMPT_SPACE_SLUG = 'agent-runtime';
export const SYSTEM_PROMPT_SLUG = 'system-prompt';
export const CHANNEL_PROMPT_PREFIX = 'channel-';

export function defaultPromptsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', 'prompts');
}

export interface PromptResolver {
  system(): string;
  channel(kind: string): string;
  isPromptDocument(slug: string | null | undefined): boolean;
  refresh(slug: string): Promise<void>;
  refreshAll(): Promise<void>;
  close(): Promise<void>;
}

export interface CreatePromptResolverOptions {
  promptsDir: string;
  mcp: McpToolHandle;
  logger?: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
}

interface DiskPrompt {
  slug: string;
  body: string;
  kind: 'system' | 'channel';
  channelKind?: string;
}

export async function createPromptResolver(
  opts: CreatePromptResolverOptions,
): Promise<PromptResolver> {
  const log = opts.logger ?? {
    info: (m) => console.log(`[prompts] ${m}`),
    warn: (m) => console.warn(`[prompts] ${m}`),
    error: (m) => console.error(`[prompts] ${m}`),
  };

  const onDisk = await readDiskPrompts(opts.promptsDir);
  if (!onDisk.find((p) => p.kind === 'system')) {
    throw new Error(
      `prompts directory ${opts.promptsDir} is missing required system.md`,
    );
  }

  const cache = new Map<string, string>();
  for (const p of onDisk) cache.set(p.slug, p.body);

  await ensureSpace(opts.mcp, log);
  for (const p of onDisk) {
    const seeded = await ensureDocument(opts.mcp, p, log);
    cache.set(p.slug, seeded);
  }

  function isPromptSlug(slug: string | null | undefined): boolean {
    if (!slug) return false;
    if (slug === SYSTEM_PROMPT_SLUG) return true;
    return slug.startsWith(CHANNEL_PROMPT_PREFIX);
  }

  async function refresh(slug: string): Promise<void> {
    const body = await readBySlug(opts.mcp, slug);
    if (body !== null) {
      cache.set(slug, body);
      log.info(`refreshed ${slug} from KB`);
    }
  }

  async function refreshAll(): Promise<void> {
    for (const slug of cache.keys()) await refresh(slug);
  }

  return {
    system(): string {
      return cache.get(SYSTEM_PROMPT_SLUG) ?? '';
    },
    channel(kind: string): string {
      const slug = `${CHANNEL_PROMPT_PREFIX}${kind}`;
      const exact = cache.get(slug);
      if (exact !== undefined) return exact;
      return cache.get(`${CHANNEL_PROMPT_PREFIX}default`) ?? '';
    },
    isPromptDocument(slug): boolean {
      return isPromptSlug(slug);
    },
    refresh,
    refreshAll,
    async close(): Promise<void> {
      // Owned by the caller; close the mcp from main.ts.
    },
  };
}

async function readDiskPrompts(dir: string): Promise<DiskPrompt[]> {
  const out: DiskPrompt[] = [];
  const systemPath = resolve(dir, 'system.md');
  const systemBody = await readFileOrNull(systemPath);
  if (systemBody !== null) {
    out.push({ slug: SYSTEM_PROMPT_SLUG, body: systemBody, kind: 'system' });
  }
  const channelsDir = resolve(dir, 'channels');
  const channelEntries = await readdir(channelsDir).catch(() => [] as string[]);
  for (const entry of channelEntries) {
    if (extname(entry) !== '.md') continue;
    const channelKind = basename(entry, '.md');
    const body = await readFileOrNull(resolve(channelsDir, entry));
    if (body === null) continue;
    out.push({
      slug: `${CHANNEL_PROMPT_PREFIX}${channelKind}`,
      body,
      kind: 'channel',
      channelKind,
    });
  }
  return out;
}

async function readFileOrNull(path: string): Promise<string | null> {
  try {
    return (await readFile(path, 'utf8')).trim();
  } catch {
    return null;
  }
}

async function ensureSpace(
  mcp: McpToolHandle,
  log: { info: (m: string) => void; warn: (m: string) => void },
): Promise<void> {
  try {
    await mcp.callTool('kb_create_space', {
      name: 'Agent runtime',
      slug: PROMPT_SPACE_SLUG,
      description:
        'Self-service AI runtime configuration. Edit the system prompt and per-channel descriptors here; the runner picks up changes within a few seconds via realtime events.',
    });
    log.info(`created KB space ${PROMPT_SPACE_SLUG}`);
  } catch (err) {
    if (looksLikeConflict(err)) return;
    throw err;
  }
}

async function ensureDocument(
  mcp: McpToolHandle,
  prompt: DiskPrompt,
  log: { info: (m: string) => void; warn: (m: string) => void },
): Promise<string> {
  const existing = await readBySlug(mcp, prompt.slug);
  if (existing !== null) return existing;
  const spaceId = await getSpaceId(mcp);
  await mcp.callTool('kb_create_document', {
    spaceId,
    slug: prompt.slug,
    title: titleFor(prompt),
    body: prompt.body,
    audiences: ['admin'],
  });
  log.info(`seeded KB doc ${PROMPT_SPACE_SLUG}/${prompt.slug} from disk`);
  return prompt.body;
}

async function readBySlug(mcp: McpToolHandle, slug: string): Promise<string | null> {
  const result = await mcp.callTool('kb_get_document_by_slug', {
    spaceSlug: PROMPT_SPACE_SLUG,
    slug,
  });
  return parseDocumentBody(result);
}

async function getSpaceId(mcp: McpToolHandle): Promise<string> {
  const result = await mcp.callTool('kb_list_spaces', {});
  const text = textFromResult(result);
  if (!text) throw new Error('kb_list_spaces returned no content');
  const parsed = JSON.parse(text) as Array<{ id: string; slug: string }>;
  const space = parsed.find((s) => s.slug === PROMPT_SPACE_SLUG);
  if (!space) throw new Error(`KB space ${PROMPT_SPACE_SLUG} not found after ensureSpace`);
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

function titleFor(prompt: DiskPrompt): string {
  if (prompt.kind === 'system') return 'System prompt';
  return `Channel descriptor — ${prompt.channelKind}`;
}

function looksLikeConflict(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const msg = 'message' in err && typeof err.message === 'string'
    ? err.message.toLowerCase()
    : '';
  return msg.includes('conflict') || msg.includes('already');
}
