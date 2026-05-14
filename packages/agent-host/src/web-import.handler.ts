import {
  BRAND_VOICE_SLUG,
  PROMPT_SPACE_SLUG,
  WebCrawler,
  openAiCompatibleProvider,
  openMcpClient,
  type CrawledPage,
  type CrawlResult,
  type CuratorJob,
  type McpToolHandle,
  type McpToolResult,
  type SkillPassResult,
} from '@getmunin/agent-runtime';

export const WEB_IMPORT_SKILL_URI = 'skill://web/scrape-site';
const TARGET_SPACE_SLUG = 'website-import';
const MAX_PAGES_TO_INSERT = 30;
const PROFILE_CONTEXT_PAGES = 8;
const PROFILE_MAX_TOKENS = 1200;
const BRAND_VOICE_MAX_TOKENS = 600;

export interface WebImportHandlerOpts {
  job: CuratorJob;
  baseUrl: string;
  adminApiKey: string;
  providerBaseUrl: string;
  providerApiKey: string;
  model: string;
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
}

export async function runWebImportJob(opts: WebImportHandlerOpts): Promise<SkillPassResult> {
  if (!opts.adminApiKey) return { ok: false, skipped: 'no_admin_key' };
  if (!opts.providerApiKey) return { ok: false, skipped: 'no_provider_key' };

  const url = opts.job.userPrompt.trim();
  if (!url) {
    return { ok: false, skipped: 'agent_error', error: 'empty url in userPrompt' };
  }

  let crawl: CrawlResult;
  try {
    const crawler = new WebCrawler();
    crawl = await crawler.crawl({ url });
  } catch (err) {
    const message = describe(err);
    opts.logger.warn(`crawl failed for ${url}: ${message}`);
    return { ok: false, skipped: 'agent_error', error: message };
  }

  let mcp: Awaited<ReturnType<typeof openMcpClient>>;
  try {
    mcp = await openMcpClient({
      baseUrl: opts.baseUrl,
      bearerToken: opts.adminApiKey,
      clientName: `agent-host-web-import-${opts.job.id.slice(-6)}`,
    });
  } catch (err) {
    opts.logger.warn(`mcp connect failed: ${describe(err)}`);
    return { ok: false, skipped: 'mcp_connect_failed' };
  }

  try {
    let spaceId: string;
    try {
      spaceId = await ensureSpace(mcp);
    } catch (err) {
      return { ok: false, skipped: 'agent_error', error: `ensureSpace failed: ${describe(err)}` };
    }

    let created = 0;
    const pagesToInsert = crawl.pages.slice(0, MAX_PAGES_TO_INSERT);
    for (const page of pagesToInsert) {
      const ok = await createPageDocument(mcp, spaceId, page, opts.logger);
      if (ok) created++;
    }

    let profileTokens = 0;
    let brandVoiceWritten = false;
    if (crawl.pages.length > 0) {
      const profile = await generateCompanyProfile({
        provider: { baseUrl: opts.providerBaseUrl, apiKey: opts.providerApiKey },
        model: opts.model,
        siteTitle: crawl.siteTitle,
        siteUrl: crawl.siteUrl,
        pages: crawl.pages.slice(0, PROFILE_CONTEXT_PAGES),
        logger: opts.logger,
      });
      if (profile) {
        profileTokens = profile.totalTokens;
        const ok = await createProfileDocument(mcp, spaceId, profile.markdown, opts.logger);
        if (ok) created++;

        const brandVoice = await generateBrandVoice({
          provider: { baseUrl: opts.providerBaseUrl, apiKey: opts.providerApiKey },
          model: opts.model,
          profileMarkdown: profile.markdown,
          logger: opts.logger,
        });
        if (brandVoice) {
          profileTokens += brandVoice.totalTokens;
          brandVoiceWritten = await upsertBrandVoiceDocument(mcp, brandVoice.markdown, opts.logger);
          if (brandVoiceWritten) created++;
        }
      }
    }

    const suffix = brandVoiceWritten ? ' Brand voice applied to agent prompt.' : '';
    const replyText = `Imported ${created} document(s) from ${crawl.siteUrl}; ${crawl.skipped.length} URL(s) skipped.${suffix}`;
    return {
      ok: true,
      toolCalls: created,
      totalTokens: profileTokens,
      finishReason: 'stop',
      replyText,
    };
  } finally {
    await mcp.close().catch((err: unknown) => {
      opts.logger.warn(`mcp close failed: ${describe(err)}`);
    });
  }
}

async function ensureSpace(mcp: McpToolHandle): Promise<string> {
  const listed = await mcp.callTool('kb_list_spaces', {});
  const existingId = findSpaceIdInResult(listed, TARGET_SPACE_SLUG);
  if (existingId) return existingId;
  const created = await mcp.callTool('kb_create_space', {
    name: 'Website import',
    slug: TARGET_SPACE_SLUG,
    description: "Pages imported from the customer's public website at onboarding.",
  });
  if (created.isError) {
    throw new Error(`kb_create_space failed: ${stringifyToolResult(created)}`);
  }
  const id = pluckId(created);
  if (!id) throw new Error('kb_create_space returned no id');
  return id;
}

async function createPageDocument(
  mcp: McpToolHandle,
  spaceId: string,
  page: CrawledPage,
  logger: WebImportHandlerOpts['logger'],
): Promise<boolean> {
  const slug = slugifyUrl(page.url);
  const baseArgs = {
    spaceId,
    title: page.title,
    body: page.markdown,
    audiences: ['admin', 'self_service'],
    tags: ['imported-from-website'],
  };
  const first = await mcp
    .callTool('kb_create_document', slug ? { ...baseArgs, slug } : baseArgs)
    .catch((err: unknown) => toolError(err));
  if (!first.isError) return true;

  if (slug) {
    const second = await mcp
      .callTool('kb_create_document', baseArgs)
      .catch((err: unknown) => toolError(err));
    if (!second.isError) return true;
    logger.warn(`kb_create_document failed for ${page.url}: ${stringifyToolResult(second)}`);
  } else {
    logger.warn(`kb_create_document failed for ${page.url}: ${stringifyToolResult(first)}`);
  }
  return false;
}

async function createProfileDocument(
  mcp: McpToolHandle,
  spaceId: string,
  body: string,
  logger: WebImportHandlerOpts['logger'],
): Promise<boolean> {
  const baseArgs = {
    spaceId,
    title: 'Company profile',
    body,
    audiences: ['admin', 'self_service'],
    tags: ['imported-from-website', 'company-profile'],
  };
  const first = await mcp
    .callTool('kb_create_document', { ...baseArgs, slug: 'company-profile' })
    .catch((err: unknown) => toolError(err));
  if (!first.isError) return true;
  const second = await mcp
    .callTool('kb_create_document', baseArgs)
    .catch((err: unknown) => toolError(err));
  if (!second.isError) return true;
  logger.warn(`company-profile kb_create_document failed: ${stringifyToolResult(second)}`);
  return false;
}

interface ProfileResult {
  markdown: string;
  totalTokens: number;
}

async function generateCompanyProfile(opts: {
  provider: { baseUrl: string; apiKey: string };
  model: string;
  siteTitle: string | null;
  siteUrl: string;
  pages: CrawledPage[];
  logger: WebImportHandlerOpts['logger'];
}): Promise<ProfileResult | null> {
  const systemPrompt = [
    "You are an onboarding agent. Read the customer's marketing pages and produce a single 'Company profile' KB document in markdown.",
    'The profile will seed a chat widget that answers questions on this company\'s website. Keep it factual: only state things supported by the pages provided.',
    'Required sections (use bold headers, not # headings; no title — the document already has one):',
    '- **One-liner** — one sentence describing what the company does and for whom.',
    '- **What they sell** — 2-5 bullets.',
    '- **Who they serve** — 1-3 bullets when stated on the site.',
    '- **Tone & voice** — one short paragraph describing how the site writes.',
    '- **Key facts** — 3-8 bullets covering pricing, regions, founding year, notable customers, certifications, etc., only when mentioned.',
    'Keep the total under 600 words. Output markdown only — no preamble, no closing remark.',
  ].join('\n');

  const userPrompt = buildProfileUserPrompt(opts.siteTitle, opts.siteUrl, opts.pages);

  try {
    const response = await openAiCompatibleProvider({
      config: {
        provider: { baseUrl: opts.provider.baseUrl, apiKey: opts.provider.apiKey },
        model: opts.model,
        systemPrompt,
        maxTokens: PROFILE_MAX_TOKENS,
      },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      tools: [],
    });
    const text = (response.message.content ?? '').toString().trim();
    if (!text) return null;
    return {
      markdown: text,
      totalTokens: response.usage?.total_tokens ?? 0,
    };
  } catch (err) {
    opts.logger.warn(`company profile generation failed: ${describe(err)}`);
    return null;
  }
}

interface BrandVoiceResult {
  markdown: string;
  totalTokens: number;
}

async function generateBrandVoice(opts: {
  provider: { baseUrl: string; apiKey: string };
  model: string;
  profileMarkdown: string;
  logger: WebImportHandlerOpts['logger'];
}): Promise<BrandVoiceResult | null> {
  const systemPrompt = [
    "You produce a short brand-voice instruction that gets appended to a chat assistant's system prompt.",
    'It tells the assistant how to write as this specific company across every channel (chat widget, email, voice).',
    'Read the company profile and produce 100-200 words of plain markdown. Cover:',
    '- The company in one short sentence (without naming the company explicitly — the assistant already speaks for them).',
    '- Tone, voice, vocabulary cues. Concrete: short sentences? technical jargon ok? warm and informal? formal and precise?',
    '- Who the assistant is speaking with (audience).',
    '- What to avoid: phrasings or claims that are off-brand or unsupported.',
    'Write in the imperative ("Be direct.", "Avoid jargon.", etc.) — instructions to the assistant, not a description of the company.',
    'Output markdown only. No headings, no preamble, no closing remark.',
  ].join('\n');

  try {
    const response = await openAiCompatibleProvider({
      config: {
        provider: { baseUrl: opts.provider.baseUrl, apiKey: opts.provider.apiKey },
        model: opts.model,
        systemPrompt,
        maxTokens: BRAND_VOICE_MAX_TOKENS,
      },
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Company profile:\n\n${truncate(opts.profileMarkdown, 6000)}`,
        },
      ],
      tools: [],
    });
    const text = (response.message.content ?? '').toString().trim();
    if (!text) return null;
    return { markdown: text, totalTokens: response.usage?.total_tokens ?? 0 };
  } catch (err) {
    opts.logger.warn(`brand voice generation failed: ${describe(err)}`);
    return null;
  }
}

async function upsertBrandVoiceDocument(
  mcp: McpToolHandle,
  body: string,
  logger: WebImportHandlerOpts['logger'],
): Promise<boolean> {
  const listed = await mcp.callTool('kb_list_spaces', {}).catch((err: unknown) => toolError(err));
  if (listed.isError) {
    logger.warn(`brand-voice kb_list_spaces failed: ${stringifyToolResult(listed)}`);
    return false;
  }
  const spaceId = findSpaceIdInResult(listed, PROMPT_SPACE_SLUG);
  if (!spaceId) {
    logger.warn(`brand-voice skipped: KB space '${PROMPT_SPACE_SLUG}' not found yet`);
    return false;
  }

  const existing = await mcp
    .callTool('kb_get_document_by_slug', {
      spaceSlug: PROMPT_SPACE_SLUG,
      slug: BRAND_VOICE_SLUG,
    })
    .catch((err: unknown) => toolError(err));
  const current = existing.isError ? null : parseExistingDocument(existing);

  if (!current) {
    const created = await mcp
      .callTool('kb_create_document', {
        spaceId,
        slug: BRAND_VOICE_SLUG,
        title: 'Brand voice',
        body,
        audiences: ['admin'],
        tags: ['agent-runtime', 'generated', 'brand-voice'],
      })
      .catch((err: unknown) => toolError(err));
    if (created.isError) {
      logger.warn(`brand-voice kb_create_document failed: ${stringifyToolResult(created)}`);
      return false;
    }
    return true;
  }

  const updated = await mcp
    .callTool('kb_update_document', {
      id: current.id,
      ifVersion: current.version,
      body,
    })
    .catch((err: unknown) => toolError(err));
  if (updated.isError) {
    logger.warn(`brand-voice kb_update_document failed: ${stringifyToolResult(updated)}`);
    return false;
  }
  return true;
}

function parseExistingDocument(res: McpToolResult): { id: string; version: number } | null {
  for (const item of res.content) {
    if (item.type !== 'text') continue;
    const text = (item as { text?: string }).text;
    if (!text || text === 'null') continue;
    try {
      const parsed = JSON.parse(text) as { id?: string; version?: number } | null;
      if (parsed && typeof parsed.id === 'string' && typeof parsed.version === 'number') {
        return { id: parsed.id, version: parsed.version };
      }
    } catch {
      // fall through to next content block
    }
  }
  return null;
}

function buildProfileUserPrompt(
  siteTitle: string | null,
  siteUrl: string,
  pages: CrawledPage[],
): string {
  const header = `Site: ${siteUrl}${siteTitle ? ` (${siteTitle})` : ''}\n\nPages:\n`;
  const blocks = pages.map((p) => {
    const body = truncate(p.markdown, 4000);
    return `--- ${p.url} — ${p.title} ---\n${body}\n`;
  });
  return header + blocks.join('\n');
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}\n…[truncated ${s.length - max} chars]`;
}

function slugifyUrl(url: string): string | undefined {
  try {
    const path = new URL(url).pathname;
    if (path === '/' || path === '') return 'home';
    const raw = path
      .replace(/^\/+|\/+$/g, '')
      .replace(/[^a-z0-9]+/gi, '-')
      .toLowerCase()
      .replace(/^-+|-+$/g, '');
    if (!raw || raw.length > 64) return undefined;
    return raw;
  } catch (err) {
    console.debug(`[web-import] slugify failed for ${url}: ${describe(err)}`);
    return undefined;
  }
}

function findSpaceIdInResult(res: McpToolResult, slug: string): string | null {
  for (const item of res.content) {
    if (item.type !== 'text') continue;
    const text = (item as { text?: string }).text;
    if (!text) continue;
    const parsed = tryParseJson(text);
    const matches = collectSpaceMatches(parsed, slug);
    if (matches.length > 0) return matches[0]!;
  }
  return null;
}

function collectSpaceMatches(value: unknown, slug: string): string[] {
  const out: string[] = [];
  visit(value, (node) => {
    if (typeof node !== 'object' || node === null) return;
    const obj = node as Record<string, unknown>;
    if (obj.slug === slug && typeof obj.id === 'string') out.push(obj.id);
  });
  return out;
}

function pluckId(res: McpToolResult): string | null {
  for (const item of res.content) {
    if (item.type !== 'text') continue;
    const text = (item as { text?: string }).text;
    if (!text) continue;
    const parsed = tryParseJson(text);
    let id: string | null = null;
    visit(parsed, (node) => {
      if (id) return;
      if (typeof node !== 'object' || node === null) return;
      const obj = node as Record<string, unknown>;
      if (typeof obj.id === 'string') id = obj.id;
    });
    if (id) return id;
  }
  return null;
}

function visit(value: unknown, fn: (node: unknown) => void): void {
  fn(value);
  if (Array.isArray(value)) {
    for (const item of value) visit(item, fn);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      visit(obj[key], fn);
    }
  }
}

function tryParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function toolError(err: unknown): McpToolResult {
  return {
    content: [{ type: 'text', text: describe(err) }],
    isError: true,
  };
}

function stringifyToolResult(res: McpToolResult): string {
  return res.content
    .map((c) => ('text' in c && typeof c.text === 'string' ? c.text : JSON.stringify(c)))
    .join(' ')
    .slice(0, 400);
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
