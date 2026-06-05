import { describe, it, expect } from 'vitest';
import {
  WebCrawler,
  extractLinks,
  extractSitemapLocs,
  normalizeCandidateUrl,
  normalizeStartUrl,
  parseRobots,
  rankUrls,
  type HtmlFetcher,
  type Extractor,
} from './web-crawl.ts';

const ORIGIN = 'https://example.com';

interface RouteMap {
  [url: string]: {
    status?: number;
    body?: string;
    contentType?: string;
    finalUrl?: string;
    throws?: Error;
  };
}

function makeFetcher(routes: RouteMap): HtmlFetcher {
  return (url) => {
    const route = routes[url];
    if (!route) {
      return Promise.resolve({ finalUrl: url, status: 404, body: '', contentType: 'text/html' });
    }
    if (route.throws) return Promise.reject(route.throws);
    return Promise.resolve({
      finalUrl: route.finalUrl ?? url,
      status: route.status ?? 200,
      body: route.body ?? '',
      contentType: route.contentType ?? 'text/html; charset=utf-8',
    });
  };
}

const goodBody = (title: string, paragraphs = 4): string =>
  `<html><head><title>${title}</title></head><body>${'<p>'.repeat(paragraphs)}${'The quick brown fox jumps over the lazy dog and considers carefully whether to leap again. '.repeat(8)}</p>${'</p>'.repeat(0)}</body></html>`;

const passthroughExtractor: Extractor = (html) => {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? titleMatch[1]!.trim() : 'Untitled';
  const text = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Promise.resolve({ title, markdown: text });
};

describe('normalizeStartUrl', () => {
  it('adds https when missing', () => {
    expect(normalizeStartUrl('example.com')?.toString()).toBe('https://example.com/');
  });
  it('preserves scheme', () => {
    expect(normalizeStartUrl('http://example.com')?.toString()).toBe('http://example.com/');
  });
  it('drops hash and query', () => {
    expect(normalizeStartUrl('https://example.com/p?q=1#x')?.toString()).toBe('https://example.com/p');
  });
  it('returns null for garbage', () => {
    expect(normalizeStartUrl(' ')).toBeNull();
  });
});

describe('normalizeCandidateUrl', () => {
  it('keeps same-origin urls', () => {
    expect(normalizeCandidateUrl('/about', ORIGIN)).toBe('https://example.com/about');
  });
  it('rejects cross-origin urls', () => {
    expect(normalizeCandidateUrl('https://other.com/x', ORIGIN)).toBeNull();
  });
  it('treats www and apex as same origin', () => {
    expect(normalizeCandidateUrl('https://www.example.com/x', ORIGIN)).toBe(
      'https://www.example.com/x',
    );
  });
  it('strips trailing slash except root', () => {
    expect(normalizeCandidateUrl('https://example.com/a/', ORIGIN)).toBe(
      'https://example.com/a',
    );
    expect(normalizeCandidateUrl('https://example.com/', ORIGIN)).toBe('https://example.com/');
  });
  it('strips query and fragment', () => {
    expect(normalizeCandidateUrl('https://example.com/p?utm=x#y', ORIGIN)).toBe(
      'https://example.com/p',
    );
  });
});

describe('parseRobots', () => {
  it('finds sitemap directives', () => {
    const r = parseRobots(`Sitemap: https://x.com/sitemap.xml\nUser-agent: *\nDisallow: /admin\n`);
    expect(r.sitemaps).toEqual(['https://x.com/sitemap.xml']);
    expect(r.isAllowed('/admin/users')).toBe(false);
    expect(r.isAllowed('/about')).toBe(true);
  });
  it('respects MuninOnboardingBot agent group', () => {
    const r = parseRobots(`User-agent: muninonboardingbot\nDisallow: /private\n`);
    expect(r.isAllowed('/private/x')).toBe(false);
    expect(r.isAllowed('/public')).toBe(true);
  });
  it('treats empty text as allow-all', () => {
    const r = parseRobots('');
    expect(r.isAllowed('/anything')).toBe(true);
    expect(r.sitemaps).toEqual([]);
  });
});

describe('extractSitemapLocs', () => {
  it('parses urlset', () => {
    const xml = `<?xml version="1.0"?><urlset><url><loc>https://example.com/a</loc></url><url><loc>https://example.com/b</loc></url></urlset>`;
    expect(extractSitemapLocs(xml)).toEqual(['https://example.com/a', 'https://example.com/b']);
  });
  it('parses sitemapindex', () => {
    const xml = `<sitemapindex><sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap></sitemapindex>`;
    expect(extractSitemapLocs(xml)).toEqual(['https://example.com/sitemap-pages.xml']);
  });
  it('decodes entities', () => {
    const xml = `<urlset><url><loc>https://example.com/a&amp;b</loc></url></urlset>`;
    expect(extractSitemapLocs(xml)).toEqual(['https://example.com/a&b']);
  });
});

describe('extractLinks', () => {
  it('resolves relative urls', () => {
    const html = `<html><body><a href="/about">x</a><a href="../pricing">y</a><a href="https://other.com/z">z</a></body></html>`;
    const links = extractLinks(html, 'https://example.com/');
    expect(links).toContain('https://example.com/about');
    expect(links).toContain('https://example.com/pricing');
    expect(links).toContain('https://other.com/z');
  });
});

describe('rankUrls', () => {
  it('puts home, about, pricing first', () => {
    const out = rankUrls(
      [
        'https://example.com/blog/post-2',
        'https://example.com/about',
        'https://example.com/',
        'https://example.com/pricing',
        'https://example.com/random/page/deep',
      ],
      ORIGIN,
    );
    expect(out[0]).toBe('https://example.com/');
    expect(out[1]).toBe('https://example.com/about');
    expect(out[2]).toBe('https://example.com/pricing');
  });
});

describe('WebCrawler.crawl', () => {
  it('uses sitemap when available and extracts pages', async () => {
    const routes: RouteMap = {
      'https://example.com/robots.txt': {
        body: `Sitemap: https://example.com/sitemap.xml\nUser-agent: *\nDisallow: /admin\n`,
        contentType: 'text/plain',
      },
      'https://example.com/sitemap.xml': {
        body: `<urlset><url><loc>https://example.com/</loc></url><url><loc>https://example.com/about</loc></url><url><loc>https://example.com/admin/x</loc></url></urlset>`,
        contentType: 'application/xml',
      },
      'https://example.com/': { body: goodBody('Home') },
      'https://example.com/about': { body: goodBody('About') },
    };
    const svc = new WebCrawler({ fetcher: makeFetcher(routes), extractor: passthroughExtractor });
    const result = await svc.crawl({ url: 'https://example.com' });
    expect(result.siteUrl).toBe('https://example.com/');
    const urls = result.pages.map((p) => p.url);
    expect(urls).toContain('https://example.com/');
    expect(urls).toContain('https://example.com/about');
    expect(urls).not.toContain('https://example.com/admin/x');
    const skippedUrls = result.skipped.map((s) => s.url);
    expect(skippedUrls).toContain('https://example.com/admin/x');
  });

  it('falls back to BFS when no sitemap', async () => {
    const routes: RouteMap = {
      'https://example.com/robots.txt': { status: 404 },
      'https://example.com/sitemap.xml': { status: 404 },
      'https://example.com/sitemap_index.xml': { status: 404 },
      'https://example.com/sitemap-pages.xml': { status: 404 },
      'https://example.com/': {
        body:
          `<html><head><title>Home</title></head><body>` +
          'The quick brown fox jumps over the lazy dog every weekday morning at sunrise and recites a small poem about the wonders of HTTP. '.repeat(
            6,
          ) +
          `<a href="/about">about</a><a href="/pricing">pricing</a></body></html>`,
      },
      'https://example.com/about': { body: goodBody('About') },
      'https://example.com/pricing': { body: goodBody('Pricing') },
    };
    const svc = new WebCrawler({ fetcher: makeFetcher(routes), extractor: passthroughExtractor });
    const result = await svc.crawl({ url: 'https://example.com' });
    const urls = result.pages.map((p) => p.url);
    expect(urls).toContain('https://example.com/about');
    expect(urls).toContain('https://example.com/pricing');
  });

  it('honors maxPages cap', async () => {
    const sitemapLocs = Array.from({ length: 30 }, (_, i) => `https://example.com/p${i}`);
    const routes: RouteMap = {
      'https://example.com/robots.txt': { status: 404 },
      'https://example.com/sitemap.xml': {
        body: `<urlset>${sitemapLocs.map((u) => `<url><loc>${u}</loc></url>`).join('')}</urlset>`,
      },
      'https://example.com/': { body: goodBody('Home') },
    };
    for (const u of sitemapLocs) routes[u] = { body: goodBody(u) };
    const svc = new WebCrawler({ fetcher: makeFetcher(routes), extractor: passthroughExtractor });
    const result = await svc.crawl({ url: 'https://example.com', maxPages: 5 });
    expect(result.pages.length).toBeLessThanOrEqual(5);
  });

  it('marks 403 as blocked, 404 as http_error', async () => {
    const routes: RouteMap = {
      'https://example.com/robots.txt': { status: 404 },
      'https://example.com/sitemap.xml': {
        body: `<urlset><url><loc>https://example.com/blocked</loc></url><url><loc>https://example.com/missing</loc></url></urlset>`,
      },
      'https://example.com/': { body: goodBody('Home') },
      'https://example.com/blocked': { status: 403, body: '<html>nope</html>' },
      'https://example.com/missing': { status: 404, body: '' },
    };
    const svc = new WebCrawler({ fetcher: makeFetcher(routes), extractor: passthroughExtractor });
    const result = await svc.crawl({ url: 'https://example.com' });
    const blocked = result.skipped.find((s) => s.url === 'https://example.com/blocked');
    const missing = result.skipped.find((s) => s.url === 'https://example.com/missing');
    expect(blocked?.reason).toBe('blocked');
    expect(missing?.reason).toBe('http_error');
  });

  it('drops pages with too-short bodies', async () => {
    const routes: RouteMap = {
      'https://example.com/robots.txt': { status: 404 },
      'https://example.com/sitemap.xml': {
        body: `<urlset><url><loc>https://example.com/</loc></url><url><loc>https://example.com/thin</loc></url></urlset>`,
      },
      'https://example.com/': { body: goodBody('Home') },
      'https://example.com/thin': { body: '<html><head><title>Thin</title></head><body><p>hi</p></body></html>' },
    };
    const svc = new WebCrawler({ fetcher: makeFetcher(routes), extractor: passthroughExtractor });
    const result = await svc.crawl({ url: 'https://example.com' });
    const thin = result.skipped.find((s) => s.url === 'https://example.com/thin');
    expect(thin?.reason).toBe('too_short');
  });

  it('throws on invalid url', async () => {
    const svc = new WebCrawler({ fetcher: makeFetcher({}), extractor: passthroughExtractor });
    await expect(svc.crawl({ url: '' })).rejects.toThrow(/invalid url/);
  });

  it('default fetcher refuses to fetch a loopback URL (SSRF guard)', async () => {
    const svc = new WebCrawler({ extractor: passthroughExtractor });
    const result = await svc.crawl({ url: 'http://127.0.0.1' });
    expect(result.pages).toHaveLength(0);
    expect(result.skipped.length).toBeGreaterThan(0);
    const blocked = result.skipped.find((s) => /private|reserved|ssrf|blocked/i.test(s.detail ?? ''));
    expect(blocked).toBeTruthy();
  });
});
