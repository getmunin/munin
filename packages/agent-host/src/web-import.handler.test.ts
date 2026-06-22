import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderError } from '@getmunin/agent-runtime';
import type * as AgentRuntime from '@getmunin/agent-runtime';
import type {
  CrawlResult,
  CuratorJob,
  McpToolHandle,
  McpToolResult,
  Provider,
} from '@getmunin/agent-runtime';
import { reconcileSpace, candidateUrls, runWebImportJob } from './web-import.handler.ts';

const probeUrlMock = vi.hoisted(() => vi.fn());
const crawlMock = vi.hoisted(() => vi.fn<(args: { url: string }) => Promise<CrawlResult>>());

vi.mock('@getmunin/agent-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof AgentRuntime>();
  return {
    ...actual,
    probeUrl: probeUrlMock,
    WebCrawler: class {
      crawl(args: { url: string }): Promise<CrawlResult> {
        return crawlMock(args);
      }
    },
  };
});

type DocRow = {
  id: string;
  slug: string | null;
  title: string;
  version: number;
  tags: string[];
};

function fakeMcp(docs: DocRow[]) {
  const deleted: string[] = [];
  const handle: McpToolHandle = {
    listTools: () => Promise.resolve([]),
    callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
      if (name === 'kb_list_documents') {
        return Promise.resolve({ content: [{ type: 'text', text: JSON.stringify(docs) }], isError: false });
      }
      if (name === 'kb_delete_document') {
        deleted.push(String(args.id));
        return Promise.resolve({
          content: [{ type: 'text', text: JSON.stringify({ deleted: true }) }],
          isError: false,
        });
      }
      return Promise.resolve({ content: [{ type: 'text', text: 'unexpected' }], isError: true });
    },
  };
  return { handle, deleted };
}

function crawlWith(paths: string[]): CrawlResult {
  return {
    siteUrl: 'https://example.com/',
    siteTitle: 'Example',
    pages: paths.map((p) => ({
      url: `https://example.com${p}`,
      title: p,
      markdown: 'x'.repeat(300),
      wordCount: 50,
    })),
    skipped: [],
  };
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const src = (url: string) => `source-url:${url}`;

beforeEach(() => {
  probeUrlMock.mockReset();
  crawlMock.mockReset();
  logger.info.mockReset();
  logger.warn.mockReset();
  logger.error.mockReset();
});

function okResult(obj: unknown): Promise<McpToolResult> {
  return Promise.resolve({ content: [{ type: 'text', text: JSON.stringify(obj) }], isError: false });
}

function importMcp() {
  const createdSlugs: string[] = [];
  const handle: McpToolHandle = {
    listTools: () => Promise.resolve([]),
    callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
      if (name === 'kb_list_spaces') return okResult([{ id: 'spc1', slug: 'website-import' }]);
      if (name === 'kb_get_document_by_slug') {
        return Promise.resolve({ content: [{ type: 'text', text: 'null' }], isError: false });
      }
      if (name === 'kb_create_document') {
        createdSlugs.push(String(args.slug));
        return okResult({ id: `doc_${createdSlugs.length}` });
      }
      return Promise.resolve({ content: [{ type: 'text', text: 'unexpected' }], isError: true });
    },
  };
  return { handle, createdSlugs };
}

describe('runWebImportJob', () => {
  it('completes the import when company-profile generation fails on a provider error', async () => {
    crawlMock.mockResolvedValue(crawlWith(['/', '/about']));
    const { handle, createdSlugs } = importMcp();
    const failingProvider: Provider = () => Promise.reject(new ProviderError('unauthorized', 401));

    const job: CuratorJob = {
      id: 'job1',
      orgId: 'org1',
      jobUri: 'task://web/scrape-website',
      userPrompt: 'https://example.com',
      sourceEventType: null,
      sourceEventPayload: { synthesizeCompanyProfile: true, reconcile: false },
      dedupeKey: null,
      status: 'pending',
      priority: 100,
      attempts: 1,
      maxAttempts: 3,
      nextAttemptAt: '2026-01-01T00:00:00.000Z',
      leaseExpiresAt: null,
      leaseHolder: null,
      lastError: null,
      lastReplyText: null,
      lastToolCalls: null,
      lastTotalTokens: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      doneAt: null,
      assistantName: null,
    };

    const result = await runWebImportJob({
      job,
      mcp: handle,
      providerBaseUrl: 'https://api.example/v1',
      providerApiKey: 'bad-key',
      model: 'm',
      provider: failingProvider,
      logger,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(createdSlugs).toEqual(['home', 'about']);
    expect(result.replyText).toContain('Imported 2 document');
    expect(result.replyText).toContain('Company profile was skipped');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('company profile skipped'));
  });
});

describe('candidateUrls', () => {
  it('prefers the stored source-url tag', () => {
    const doc: DocRow = { id: 'd', slug: 'pricing', title: 'P', version: 1, tags: [src('https://x.com/p')] };
    expect(candidateUrls(doc, 'https://example.com')).toEqual(['https://x.com/p']);
  });
  it('reconstructs flat and slashed URLs from the slug when untagged', () => {
    const doc: DocRow = { id: 'd', slug: 'en-docs-guides', title: 'D', version: 1, tags: ['imported-from-website'] };
    expect(candidateUrls(doc, 'https://example.com')).toEqual([
      'https://example.com/en-docs-guides',
      'https://example.com/en/docs/guides',
    ]);
  });
  it('maps the home slug to the origin root', () => {
    const doc: DocRow = { id: 'd', slug: 'home', title: 'H', version: 1, tags: [] };
    expect(candidateUrls(doc, 'https://example.com')).toEqual(['https://example.com/']);
  });
});

describe('reconcileSpace', () => {
  const live = ['/', '/about', '/contact'];

  it('prunes a doc whose source page is confirmed gone (404), keeping live and unverifiable docs', async () => {
    const docs: DocRow[] = [
      { id: 'd_pricing', slug: 'pricing', title: 'Pricing', version: 2, tags: ['imported-from-website', src('https://example.com/pricing')] },
      { id: 'd_about', slug: 'about', title: 'About', version: 1, tags: ['imported-from-website', src('https://example.com/about')] },
      { id: 'd_profile', slug: 'company-profile', title: 'Company profile', version: 5, tags: ['imported-from-website', 'company-profile'] },
      { id: 'd_old', slug: 'old', title: 'Old', version: 1, tags: ['imported-from-website', src('https://example.com/old')] },
      { id: 'd_flaky', slug: 'flaky', title: 'Flaky', version: 1, tags: ['imported-from-website', src('https://example.com/flaky')] },
    ];
    probeUrlMock.mockImplementation((url: string) => {
      if (url === 'https://example.com/pricing') return Promise.resolve({ status: 404, finalUrl: url });
      if (url === 'https://example.com/old') return Promise.resolve({ status: 200, finalUrl: url });
      if (url === 'https://example.com/flaky') return Promise.reject(new Error('timeout'));
      return Promise.resolve({ status: 200, finalUrl: url });
    });

    const { handle, deleted } = fakeMcp(docs);
    const pruned = await reconcileSpace(handle, 'spc', crawlWith(live), 4, logger);

    expect(pruned).toBe(1);
    expect(deleted).toEqual(['d_pricing']);
  });

  it('refuses to prune when the crawl is too small', async () => {
    const docs: DocRow[] = [
      { id: 'd_pricing', slug: 'pricing', title: 'Pricing', version: 2, tags: ['imported-from-website', src('https://example.com/pricing')] },
    ];
    probeUrlMock.mockResolvedValue({ status: 404, finalUrl: 'x' });
    const { handle, deleted } = fakeMcp(docs);

    const pruned = await reconcileSpace(handle, 'spc', crawlWith(['/', '/about']), 2, logger);

    expect(pruned).toBe(0);
    expect(deleted).toEqual([]);
    expect(probeUrlMock).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });
});
