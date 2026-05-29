import { safeFetch } from '@getmunin/core';

const USER_AGENT = 'MuninOnboardingBot/1.0 (+https://getmunin.com/bot)';
const DEFAULT_MAX_PAGES = 25;
const HARD_MAX_PAGES = 50;
const FETCH_TIMEOUT_MS = 5000;
const FETCH_CONCURRENCY = 8;
const MIN_BODY_CHARS = 200;
const BFS_MAX_DEPTH = 2;
const PER_HOST_MIN_INTERVAL_MS = 250;
const PRIORITY_PATTERNS: ReadonlyArray<{ test: (path: string) => boolean; weight: number }> = [
  { test: (p) => p === '/' || p === '', weight: 0 },
  { test: (p) => /^\/about(\/|$)/i.test(p), weight: 10 },
  { test: (p) => /^\/pricing(\/|$)/i.test(p), weight: 20 },
  { test: (p) => /^\/(products?|features?|solutions?|platform)(\/|$)/i.test(p), weight: 30 },
  { test: (p) => /^\/(faq|help|support|docs?)(\/|$)/i.test(p), weight: 40 },
  { test: (p) => /^\/contact(\/|$)/i.test(p), weight: 50 },
  { test: (p) => /^\/(team|company|customers|case-stud)/i.test(p), weight: 60 },
  { test: (p) => /^\/(blog|news|insights|resources?|guides?)(\/|$)/i.test(p), weight: 70 },
];

export interface CrawlOptions {
  url: string;
  maxPages?: number;
}

export interface CrawledPage {
  url: string;
  title: string;
  markdown: string;
  wordCount: number;
}

export type SkipReason =
  | 'fetch_failed'
  | 'http_error'
  | 'too_short'
  | 'blocked'
  | 'timeout'
  | 'robots_disallow'
  | 'wrong_host'
  | 'extract_failed';

export interface SkippedPage {
  url: string;
  reason: SkipReason;
  detail?: string;
}

export interface CrawlResult {
  siteUrl: string;
  siteTitle: string | null;
  pages: CrawledPage[];
  skipped: SkippedPage[];
}

interface FetchedHtml {
  finalUrl: string;
  status: number;
  body: string;
  contentType: string;
}

export type HtmlFetcher = (url: string) => Promise<FetchedHtml>;
export type Extractor = (
  html: string,
  url: string,
) => Promise<{ title: string; markdown: string } | null>;

export interface WebCrawlerOptions {
  fetcher?: HtmlFetcher;
  extractor?: Extractor;
}

export class WebCrawler {
  private readonly fetcher: HtmlFetcher;
  private readonly extractor: Extractor;

  constructor(opts: WebCrawlerOptions = {}) {
    this.fetcher = opts.fetcher ?? defaultFetcher;
    this.extractor = opts.extractor ?? defaultExtractor;
  }

  async crawl(opts: CrawlOptions): Promise<CrawlResult> {
    const start = normalizeStartUrl(opts.url);
    if (!start) {
      throw new Error(`invalid url: ${opts.url}`);
    }
    const maxPages = Math.max(1, Math.min(opts.maxPages ?? DEFAULT_MAX_PAGES, HARD_MAX_PAGES));
    const origin = start.origin;
    const robots = await this.loadRobots(origin);

    const candidateSet = new Set<string>();
    const addCandidate = (raw: string): void => {
      const normalized = normalizeCandidateUrl(raw, origin);
      if (!normalized) return;
      candidateSet.add(normalized);
    };

    addCandidate(start.toString());
    for (const sm of robots.sitemaps) {
      for (const u of await this.readSitemap(sm, origin)) addCandidate(u);
    }
    if (candidateSet.size <= 1) {
      const fallbacks = [
        `${origin}/sitemap.xml`,
        `${origin}/sitemap_index.xml`,
        `${origin}/sitemap-pages.xml`,
      ];
      for (const sm of fallbacks) {
        for (const u of await this.readSitemap(sm, origin)) addCandidate(u);
      }
    }

    const skipped: SkippedPage[] = [];
    let candidates = [...candidateSet].filter((u) => {
      const path = pathOf(u);
      if (!path) return true;
      if (!robots.isAllowed(path)) {
        skipped.push({ url: u, reason: 'robots_disallow' });
        return false;
      }
      return true;
    });

    if (candidates.length < 2) {
      const bfsFound = await this.bfsDiscover(start.toString(), origin, robots, maxPages, skipped);
      for (const u of bfsFound) addCandidate(u);
      candidates = [...candidateSet].filter((u) => {
        const path = pathOf(u);
        return path ? robots.isAllowed(path) : true;
      });
    }

    const ranked = rankUrls(candidates, origin).slice(0, maxPages);

    const pages: CrawledPage[] = [];
    let siteTitle: string | null = null;
    const lastHitByHost = new Map<string, number>();

    await runWithConcurrency(ranked, FETCH_CONCURRENCY, async (target) => {
      await politeWait(target, lastHitByHost);
      let fetched: FetchedHtml;
      try {
        fetched = await this.fetcher(target);
      } catch (err) {
        const message = describe(err);
        const reason: SkipReason = /timeout|aborted/i.test(message) ? 'timeout' : 'fetch_failed';
        skipped.push({ url: target, reason, detail: message });
        return;
      }
      if (fetched.status === 403 || fetched.status === 401 || fetched.status === 429) {
        skipped.push({ url: target, reason: 'blocked', detail: `HTTP ${fetched.status}` });
        return;
      }
      if (fetched.status >= 400) {
        skipped.push({ url: target, reason: 'http_error', detail: `HTTP ${fetched.status}` });
        return;
      }
      if (!fetched.contentType.includes('html')) {
        skipped.push({
          url: target,
          reason: 'http_error',
          detail: `non-HTML: ${fetched.contentType}`,
        });
        return;
      }
      let extracted: { title: string; markdown: string } | null;
      try {
        extracted = await this.extractor(fetched.body, fetched.finalUrl);
      } catch (err) {
        skipped.push({ url: target, reason: 'extract_failed', detail: describe(err) });
        return;
      }
      if (!extracted) {
        skipped.push({ url: target, reason: 'extract_failed' });
        return;
      }
      const text = extracted.markdown.trim();
      if (text.length < MIN_BODY_CHARS) {
        skipped.push({ url: target, reason: 'too_short', detail: `${text.length} chars` });
        return;
      }
      const wordCount = countWords(text);
      pages.push({
        url: fetched.finalUrl,
        title: extracted.title || guessTitleFromUrl(target),
        markdown: text,
        wordCount,
      });
      if (!siteTitle && fetched.finalUrl === start.toString()) {
        siteTitle = extracted.title || null;
      }
    });

    pages.sort((a, b) => rankOf(a.url, origin) - rankOf(b.url, origin));
    return { siteUrl: start.toString(), siteTitle, pages, skipped };
  }

  private async loadRobots(origin: string): Promise<RobotsRules> {
    const robotsUrl = `${origin}/robots.txt`;
    try {
      const res = await this.fetcher(robotsUrl);
      if (res.status >= 200 && res.status < 300) {
        return parseRobots(res.body);
      }
    } catch (err) {
      console.debug(`[web-crawl] robots.txt fetch failed for ${origin}: ${describe(err)}`);
    }
    return parseRobots('');
  }

  private async readSitemap(url: string, origin: string): Promise<string[]> {
    try {
      const res = await this.fetcher(url);
      if (res.status < 200 || res.status >= 300) return [];
      const isIndex = /<sitemapindex/i.test(res.body);
      const locs = extractSitemapLocs(res.body);
      if (!isIndex) return locs.filter((u) => sameOrigin(u, origin));
      const out: string[] = [];
      for (const sub of locs.slice(0, 5)) {
        for (const u of await this.readSitemap(sub, origin)) out.push(u);
        if (out.length >= 200) break;
      }
      return out;
    } catch (err) {
      console.debug(`[web-crawl] sitemap read failed for ${url}: ${describe(err)}`);
      return [];
    }
  }

  private async bfsDiscover(
    seed: string,
    origin: string,
    robots: RobotsRules,
    maxPages: number,
    skipped: SkippedPage[],
  ): Promise<string[]> {
    const visited = new Set<string>([seed]);
    const found = new Set<string>([seed]);
    let frontier: string[] = [seed];
    for (let depth = 0; depth < BFS_MAX_DEPTH; depth++) {
      const next: string[] = [];
      for (const url of frontier) {
        if (found.size >= maxPages * 2) break;
        let res: FetchedHtml;
        try {
          res = await this.fetcher(url);
        } catch (err) {
          console.debug(`[web-crawl] bfs fetch failed for ${url}: ${describe(err)}`);
          continue;
        }
        if (res.status >= 400 || !res.contentType.includes('html')) continue;
        for (const link of extractLinks(res.body, res.finalUrl)) {
          const normalized = normalizeCandidateUrl(link, origin);
          if (!normalized) continue;
          if (visited.has(normalized)) continue;
          visited.add(normalized);
          const path = pathOf(normalized);
          if (path && !robots.isAllowed(path)) {
            skipped.push({ url: normalized, reason: 'robots_disallow' });
            continue;
          }
          found.add(normalized);
          next.push(normalized);
          if (found.size >= maxPages * 2) break;
        }
      }
      if (next.length === 0) break;
      frontier = next;
    }
    return [...found];
  }
}

interface RobotsRules {
  sitemaps: string[];
  isAllowed: (path: string) => boolean;
}

export function parseRobots(text: string): RobotsRules {
  const sitemaps: string[] = [];
  const groups: { agents: string[]; disallows: string[] }[] = [];
  let current: { agents: string[]; disallows: string[] } | null = null;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [keyRaw, ...rest] = line.split(':');
    if (!keyRaw || rest.length === 0) continue;
    const key = keyRaw.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'sitemap') {
      sitemaps.push(value);
      continue;
    }
    if (key === 'user-agent') {
      if (!current || current.disallows.length > 0) {
        current = { agents: [value.toLowerCase()], disallows: [] };
        groups.push(current);
      } else {
        current.agents.push(value.toLowerCase());
      }
      continue;
    }
    if (key === 'disallow' && current) {
      if (value) current.disallows.push(value);
      continue;
    }
  }
  const ua = USER_AGENT.toLowerCase();
  const matching = groups.filter((g) =>
    g.agents.some((a) => a === '*' || ua.startsWith(a) || a === 'muninonboardingbot'),
  );
  return {
    sitemaps,
    isAllowed(path: string): boolean {
      for (const g of matching) {
        for (const dis of g.disallows) {
          if (dis === '/' || (dis && path.startsWith(dis))) return false;
        }
      }
      return true;
    },
  };
}

export function extractSitemapLocs(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([^<\s][^<]*?)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push(decodeEntities(m[1]!));
  }
  return out;
}

export function extractLinks(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  const re = /<a\s[^>]*href\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = decodeEntities(m[1]!);
    try {
      out.push(new URL(raw, baseUrl).toString());
    } catch (err) {
      console.debug(`[web-crawl] malformed link "${raw}" in ${baseUrl}: ${describe(err)}`);
    }
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function normalizeStartUrl(input: string): URL | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withProtocol);
    u.hash = '';
    u.search = '';
    if (u.pathname === '') u.pathname = '/';
    return u;
  } catch (err) {
    console.debug(`[web-crawl] could not parse start url "${input}": ${describe(err)}`);
    return null;
  }
}

export function normalizeCandidateUrl(raw: string, origin: string): string | null {
  try {
    const u = new URL(raw, origin);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!sameOrigin(u.toString(), origin)) return null;
    u.hash = '';
    u.search = '';
    if (u.pathname !== '/' && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.replace(/\/+$/, '') || '/';
    }
    return u.toString();
  } catch (err) {
    console.debug(
      `[web-crawl] could not normalize candidate "${raw}" against ${origin}: ${describe(err)}`,
    );
    return null;
  }
}

function sameOrigin(url: string, origin: string): boolean {
  try {
    const a = new URL(url);
    const b = new URL(origin);
    return stripWww(a.host) === stripWww(b.host) && a.protocol === b.protocol;
  } catch (err) {
    console.debug(`[web-crawl] sameOrigin parse failed for "${url}" vs "${origin}": ${describe(err)}`);
    return false;
  }
}

function stripWww(host: string): string {
  return host.replace(/^www\./i, '');
}

function pathOf(url: string): string | null {
  try {
    return new URL(url).pathname || '/';
  } catch (err) {
    console.debug(`[web-crawl] pathOf parse failed for "${url}": ${describe(err)}`);
    return null;
  }
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch (err) {
    console.debug(`[web-crawl] safeHost parse failed for "${url}": ${describe(err)}`);
    return null;
  }
}

export function rankUrls(urls: string[], origin: string): string[] {
  return [...urls].sort((a, b) => {
    const ra = rankOf(a, origin);
    const rb = rankOf(b, origin);
    if (ra !== rb) return ra - rb;
    return a.length - b.length;
  });
}

function rankOf(url: string, origin: string): number {
  const path = pathOf(url) ?? '/';
  if (url === origin || url === `${origin}/`) return 0;
  for (const { test, weight } of PRIORITY_PATTERNS) {
    if (test(path)) return weight;
  }
  const depth = path.split('/').filter(Boolean).length;
  return 200 + depth * 5;
}

function guessTitleFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    const tail = path.split('/').filter(Boolean).pop() ?? 'Home';
    return (
      tail
        .replace(/[-_]+/g, ' ')
        .replace(/\.[a-z0-9]+$/i, '')
        .replace(/\b\w/g, (c) => c.toUpperCase()) || 'Home'
    );
  } catch (err) {
    console.debug(`[web-crawl] guessTitleFromUrl failed for "${url}": ${describe(err)}`);
    return 'Page';
  }
}

function countWords(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0;
  const workers: Promise<void>[] = [];
  const next = async (): Promise<void> => {
    while (i < items.length) {
      const idx = i++;
      await task(items[idx]!);
    }
  };
  for (let w = 0; w < Math.max(1, Math.min(limit, items.length)); w++) workers.push(next());
  await Promise.all(workers);
}

async function politeWait(url: string, lastByHost: Map<string, number>): Promise<void> {
  const host = safeHost(url);
  if (!host) return;
  const last = lastByHost.get(host) ?? 0;
  const wait = last + PER_HOST_MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastByHost.set(host, Date.now());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const defaultFetcher: HtmlFetcher = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await safeFetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en;q=0.9,*;q=0.5',
        'accept-encoding': 'gzip, deflate, br',
      },
    });
    const body = await res.text();
    return {
      finalUrl: res.url || url,
      status: res.status,
      body,
      contentType: (res.headers.get('content-type') ?? '').toLowerCase(),
    };
  } finally {
    clearTimeout(timer);
  }
};

const DEFUDDLE_NOISE = /^Initial parse returned very little content/;

const defaultExtractor: Extractor = async (html, url) => {
  const fn = await loadDefuddle();
  if (!fn) return extractBasic(html);
  try {
    const result = await withSilencedDefuddleLogs(() => fn(html, url, { markdown: true }));
    const md = (result?.content ?? '').toString().trim();
    if (!md) return null;
    return { title: (result?.title ?? '').toString().trim(), markdown: md };
  } catch (err) {
    console.warn(
      `[web-crawl] defuddle extraction failed for "${url}", falling back: ${describe(err)}`,
    );
    return extractBasic(html);
  }
};

async function withSilencedDefuddleLogs<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.log;
  console.log = (...args: unknown[]) => {
    const first = args[0];
    if (typeof first === 'string' && DEFUDDLE_NOISE.test(first)) return;
    original(...args);
  };
  try {
    return await fn();
  } finally {
    console.log = original;
  }
}

type DefuddleFn = (
  html: string,
  url: string | undefined,
  options: { markdown: boolean },
) => Promise<{ title?: string; content?: string }>;

let defuddleCache: DefuddleFn | null | undefined;

async function loadDefuddle(): Promise<DefuddleFn | null> {
  if (defuddleCache !== undefined) return defuddleCache;
  try {
    const mod = (await import('defuddle/node')) as Record<string, unknown>;
    const fn = (mod.Defuddle ?? mod.default ?? mod.defuddle) as DefuddleFn | undefined;
    defuddleCache = fn ?? null;
    return defuddleCache;
  } catch (err) {
    console.warn(
      `[web-crawl] defuddle module load failed, using basic extractor: ${describe(err)}`,
    );
    defuddleCache = null;
    return null;
  }
}

function extractBasic(html: string): { title: string; markdown: string } | null {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? decodeEntities(titleMatch[1]!).replace(/\s+/g, ' ').trim() : '';
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  const text = decodeEntities(stripped).replace(/\s+/g, ' ').trim();
  if (text.length < MIN_BODY_CHARS) return null;
  return { title, markdown: text };
}
