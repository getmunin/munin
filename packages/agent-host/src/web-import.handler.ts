import {
  WebCrawler,
  classifyProviderError,
  openAiCompatibleProvider,
  probeUrl,
  type CrawledPage,
  type CrawlResult,
  type CuratorJob,
  type McpToolHandle,
  type McpToolResult,
  type Provider,
  type ProviderErrorClassification,
  type SkillPassResult,
} from '@getmunin/agent-runtime';
import type { WebImportProgress } from '@getmunin/types';

const TARGET_SPACE_SLUG = 'website-import';
const MAX_PAGES_TO_INSERT = 30;
const PROFILE_CONTEXT_PAGES = 8;
const PROFILE_MAX_TOKENS = 1200;
const IMPORT_TAG = 'imported-from-website';
const PROFILE_TAG = 'company-profile';
const PROFILE_SLUG = 'company-profile';
const SOURCE_URL_TAG_PREFIX = 'source-url:';
const MIN_PAGES_FOR_PRUNE = 3;

export interface WebImportHandlerOpts {
  job: CuratorJob;
  mcp: McpToolHandle;
  providerBaseUrl: string;
  providerApiKey: string;
  model: string;
  provider?: Provider;
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  onProgress?: (p: WebImportProgress) => void;
}

export async function runWebImportJob(opts: WebImportHandlerOpts): Promise<SkillPassResult> {
  if (!opts.providerApiKey) return { ok: false, skipped: 'no_provider_key' };

  const url = opts.job.userPrompt.trim();
  if (!url) {
    return { ok: false, skipped: 'agent_error', error: 'empty url in userPrompt' };
  }

  let crawl: CrawlResult;
  try {
    const crawler = new WebCrawler();
    crawl = await crawler.crawl({ url, onProgress: opts.onProgress });
  } catch (err) {
    const message = describe(err);
    opts.logger.warn(`crawl failed for ${url}: ${message}`);
    return { ok: false, skipped: 'agent_error', error: message };
  }

  const mcp = opts.mcp;

  let spaceId: string;
  try {
    spaceId = await ensureSpace(mcp);
  } catch (err) {
    return { ok: false, skipped: 'agent_error', error: `ensureSpace failed: ${describe(err)}` };
  }

  let created = 0;
  const pagesToInsert = crawl.pages.slice(0, MAX_PAGES_TO_INSERT);
  for (const page of pagesToInsert) {
    const ok = await upsertPageDocument(mcp, spaceId, page, opts.logger);
    if (ok) created++;
  }

  const payload = opts.job.sourceEventPayload as {
    synthesizeCompanyProfile?: boolean;
    reconcile?: boolean;
  } | null;
  const synthesizeCompanyProfile = payload?.synthesizeCompanyProfile !== false;
  const reconcile = payload?.reconcile !== false;

  let profileTokens = 0;
  let profileSkipped = false;
  if (crawl.pages.length > 0 && synthesizeCompanyProfile) {
    const outcome = await generateCompanyProfile({
      provider: { baseUrl: opts.providerBaseUrl, apiKey: opts.providerApiKey },
      providerImpl: opts.provider,
      model: opts.model,
      siteTitle: crawl.siteTitle,
      siteUrl: crawl.siteUrl,
      pages: crawl.pages.slice(0, PROFILE_CONTEXT_PAGES),
      logger: opts.logger,
    });
    if (outcome.ok) {
      profileTokens = outcome.profile.totalTokens;
      const ok = await upsertProfileDocument(mcp, spaceId, outcome.profile.markdown, opts.logger);
      if (ok) created++;
    } else if (outcome.providerError) {
      profileSkipped = true;
      opts.logger.warn(
        `company profile skipped for ${crawl.siteUrl} — LLM provider error ` +
          `(${outcome.providerError.code}): ${outcome.providerError.message}. ` +
          `Imported the pages without it; check the agent's provider credentials.`,
      );
    }
  }

  let pruned = 0;
  if (reconcile) {
    pruned = await reconcileSpace(mcp, spaceId, crawl, created, opts.logger);
  }

  const prunedText = pruned > 0 ? ` Pruned ${pruned} document(s) no longer on the site.` : '';
  const profileText = profileSkipped ? ' Company profile was skipped (LLM provider error).' : '';
  const replyText = `Imported ${created} document(s) from ${crawl.siteUrl}; ${crawl.skipped.length} URL(s) skipped.${prunedText}${profileText}`;
  return {
    ok: true,
    toolCalls: created + pruned,
    totalTokens: profileTokens,
    finishReason: 'stop',
    replyText,
  };
}

export interface DocSummary {
  id: string;
  slug: string | null;
  title: string;
  version: number;
  tags: string[];
}

export async function reconcileSpace(
  mcp: McpToolHandle,
  spaceId: string,
  crawl: CrawlResult,
  importedDocs: number,
  logger: WebImportHandlerOpts['logger'],
): Promise<number> {
  if (crawl.pages.length < MIN_PAGES_FOR_PRUNE || importedDocs === 0) {
    logger.warn(
      `reconcile skipped for ${crawl.siteUrl}: crawl too small (${crawl.pages.length} page(s), ${importedDocs} imported) — refusing to prune`,
    );
    return 0;
  }

  const origin = originOf(crawl.siteUrl);
  const liveSlugs = new Set<string>([PROFILE_SLUG]);
  for (const page of crawl.pages) {
    const slug = slugifyUrl(page.url);
    if (slug) liveSlugs.add(slug);
  }

  const listed = await mcp
    .callTool('kb_list_documents', { spaceId, tag: IMPORT_TAG, limit: 200 })
    .catch((err: unknown) => toolError(err));
  if (listed.isError) {
    logger.warn(`reconcile: kb_list_documents failed: ${stringifyToolResult(listed)}`);
    return 0;
  }
  const docs = parseDocumentSummaries(listed);
  if (docs.length >= 200) {
    logger.warn(`reconcile: hit 200-document list cap for space ${spaceId}; some docs were not checked`);
  }

  let pruned = 0;
  for (const doc of docs) {
    if (!doc.slug || liveSlugs.has(doc.slug)) continue;
    if (doc.slug === PROFILE_SLUG || doc.tags.includes(PROFILE_TAG)) continue;

    const candidates = candidateUrls(doc, origin);
    if (candidates.length === 0) continue;

    const verdict = await classifyDocLiveness(candidates);
    if (verdict !== 'gone') {
      if (verdict === 'unknown') {
        logger.info(`reconcile: leaving "${doc.title}" (${doc.slug}) — could not confirm its source page is gone`);
      }
      continue;
    }

    const deleted = await mcp
      .callTool('kb_delete_document', { id: doc.id, ifVersion: doc.version })
      .catch((err: unknown) => toolError(err));
    if (deleted.isError) {
      logger.warn(`reconcile: kb_delete_document failed for ${doc.slug}: ${stringifyToolResult(deleted)}`);
      continue;
    }
    pruned++;
    logger.info(`reconcile: pruned "${doc.title}" (${doc.slug}) — source page is gone`);
  }
  return pruned;
}

export function candidateUrls(doc: DocSummary, origin: string | null): string[] {
  const tagged = doc.tags.find((t) => t.startsWith(SOURCE_URL_TAG_PREFIX));
  if (tagged) {
    const url = tagged.slice(SOURCE_URL_TAG_PREFIX.length).trim();
    return url ? [url] : [];
  }
  if (!origin || !doc.slug) return [];
  if (doc.slug === 'home') return [`${origin}/`];
  const flat = `${origin}/${doc.slug}`;
  const slashed = `${origin}/${doc.slug.replace(/-/g, '/')}`;
  return flat === slashed ? [flat] : [flat, slashed];
}

async function classifyDocLiveness(urls: string[]): Promise<'alive' | 'gone' | 'unknown'> {
  let sawGone = false;
  for (const url of urls) {
    try {
      const { status } = await probeUrl(url);
      if (status === 404 || status === 410) {
        sawGone = true;
      } else {
        return 'alive';
      }
    } catch {
      // transient/network error — inconclusive for this candidate, fall through
    }
  }
  return sawGone ? 'gone' : 'unknown';
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function parseDocumentSummaries(res: McpToolResult): DocSummary[] {
  for (const item of res.content) {
    if (item.type !== 'text') continue;
    const text = (item as { text?: string }).text;
    if (!text) continue;
    const parsed = tryParseJson(text);
    const arr = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { documents?: unknown }).documents)
        ? (parsed as { documents: unknown[] }).documents
        : null;
    if (!arr) continue;
    const out: DocSummary[] = [];
    for (const node of arr) {
      if (!node || typeof node !== 'object') continue;
      const obj = node as Record<string, unknown>;
      if (typeof obj.id !== 'string' || typeof obj.version !== 'number') continue;
      out.push({
        id: obj.id,
        slug: typeof obj.slug === 'string' ? obj.slug : null,
        title: typeof obj.title === 'string' ? obj.title : '',
        version: obj.version,
        tags: Array.isArray(obj.tags) ? obj.tags.filter((t): t is string => typeof t === 'string') : [],
      });
    }
    return out;
  }
  return [];
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

interface KbDocFields {
  spaceId: string;
  title: string;
  body: string;
  audiences: string[];
  tags: string[];
}

async function upsertKbDocumentBySlug(
  mcp: McpToolHandle,
  spaceSlug: string,
  slug: string,
  fields: KbDocFields,
  label: string,
  logger: WebImportHandlerOpts['logger'],
): Promise<boolean> {
  const existing = await mcp
    .callTool('kb_get_document_by_slug', { spaceSlug, slug })
    .catch((err: unknown) => toolError(err));
  const current = existing.isError ? null : parseExistingDocument(existing);

  if (!current) {
    const created = await mcp
      .callTool('kb_create_document', { ...fields, slug })
      .catch((err: unknown) => toolError(err));
    if (!created.isError) return true;
    logger.warn(`${label}: kb_create_document failed: ${stringifyToolResult(created)}`);
    return false;
  }

  const updated = await mcp
    .callTool('kb_update_document', {
      id: current.id,
      ifVersion: current.version,
      title: fields.title,
      body: fields.body,
      audiences: fields.audiences,
      tags: fields.tags,
    })
    .catch((err: unknown) => toolError(err));
  if (!updated.isError) return true;
  logger.warn(`${label}: kb_update_document failed: ${stringifyToolResult(updated)}`);
  return false;
}

async function upsertPageDocument(
  mcp: McpToolHandle,
  spaceId: string,
  page: CrawledPage,
  logger: WebImportHandlerOpts['logger'],
): Promise<boolean> {
  const slug = slugifyUrl(page.url);
  if (!slug) {
    logger.warn(`skipping ${page.url}: no valid slug`);
    return false;
  }
  return upsertKbDocumentBySlug(
    mcp,
    TARGET_SPACE_SLUG,
    slug,
    {
      spaceId,
      title: page.title,
      body: page.markdown,
      audiences: ['admin', 'self_service'],
      tags: [IMPORT_TAG, `${SOURCE_URL_TAG_PREFIX}${page.url}`],
    },
    `page ${page.url}`,
    logger,
  );
}

async function upsertProfileDocument(
  mcp: McpToolHandle,
  spaceId: string,
  body: string,
  logger: WebImportHandlerOpts['logger'],
): Promise<boolean> {
  return upsertKbDocumentBySlug(
    mcp,
    TARGET_SPACE_SLUG,
    PROFILE_SLUG,
    {
      spaceId,
      title: 'Company profile',
      body,
      audiences: ['admin', 'self_service'],
      tags: [IMPORT_TAG, PROFILE_TAG],
    },
    'company profile',
    logger,
  );
}

interface ProfileResult {
  markdown: string;
  totalTokens: number;
}

type GenerateProfileOutcome =
  | { ok: true; profile: ProfileResult }
  | { ok: false; providerError: ProviderErrorClassification }
  | { ok: false; providerError: null };

async function generateCompanyProfile(opts: {
  provider: { baseUrl: string; apiKey: string };
  providerImpl?: Provider;
  model: string;
  siteTitle: string | null;
  siteUrl: string;
  pages: CrawledPage[];
  logger: WebImportHandlerOpts['logger'];
}): Promise<GenerateProfileOutcome> {
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
    const callProvider = opts.providerImpl ?? openAiCompatibleProvider;
    const response = await callProvider({
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
    if (!text) return { ok: false, providerError: null };
    return {
      ok: true,
      profile: {
        markdown: text,
        totalTokens: response.usage?.total_tokens ?? 0,
      },
    };
  } catch (err) {
    const classified = classifyProviderError(err);
    opts.logger.warn(`company profile generation failed: ${classified.message}`);
    if (classified.status !== undefined) {
      return { ok: false, providerError: classified };
    }
    return { ok: false, providerError: null };
  }
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
    if (!raw) return 'home';
    const truncated = raw.length > 64 ? raw.slice(0, 64).replace(/-+$/g, '') : raw;
    return truncated || undefined;
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

function parseExistingDocument(res: McpToolResult): { id: string; version: number } | null {
  for (const item of res.content) {
    if (item.type !== 'text') continue;
    const text = (item as { text?: string }).text;
    if (!text || text === 'null') continue;
    const parsed = tryParseJson(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as { id?: unknown; version?: unknown };
      if (typeof obj.id === 'string' && typeof obj.version === 'number') {
        return { id: obj.id, version: obj.version };
      }
    }
  }
  return null;
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
