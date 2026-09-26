import { parseArgs } from 'node:util';
import type { ConnectionRow } from '../src/modules/connectors/connectors.service.ts';
import { DataForSeoAdapter } from '../src/modules/seo/dataforseo.adapter.ts';
import { DATAFORSEO_MARKETS } from '../src/modules/seo/dataforseo.markets.ts';
import {
  SeoResearchService,
  type ResearchConnectorAccess,
} from '../src/modules/seo/seo-research.service.ts';
import type { SeoMarket } from '../src/modules/seo/seo-adapter.ts';

const usage = `Live DataForSEO smoke test. Spends real money on the account whose credentials you pass.

  DATAFORSEO_LOGIN=… DATAFORSEO_PASSWORD=… \\
    pnpm -F @getmunin/backend-core smoke:dataforseo -- \\
      --target example.no --competitor competitor.example [--competitor …] \\
      [--location norway] [--limit 20] [--max-cost 0.50] [--verify-markets]`;

const { values } = parseArgs({
  options: {
    target: { type: 'string' },
    competitor: { type: 'string', multiple: true },
    location: { type: 'string', default: 'norway' },
    limit: { type: 'string', default: '20' },
    'max-cost': { type: 'string', default: '0.50' },
    'verify-markets': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

const login = process.env.DATAFORSEO_LOGIN;
const password = process.env.DATAFORSEO_PASSWORD;
if (values.help || !login || !password || !values.target || !values.competitor?.length) {
  console.error(usage);
  process.exit(values.help ? 0 : 1);
}

const adapter = new DataForSeoAdapter();
const now = new Date();
const row: ConnectionRow = {
  id: 'cnc_smoke',
  orgId: 'org_smoke',
  vendor: adapter.vendor,
  domain: adapter.domain,
  name: 'DataForSEO smoke',
  config: { encryptedLogin: login, encryptedPassword: password },
  active: true,
  credentialState: 'active',
  lastTestedAt: null,
  lastTestError: null,
  createdAt: now,
  updatedAt: now,
};
const access: ResearchConnectorAccess = {
  resolveScope: () => Promise.resolve({ connection: row, adapter }),
  connectionContext: (r) => ({ config: r.config, decryptSecret: (value) => Promise.resolve(value) }),
  vendorCall: (fn) => fn(),
};
const research = new SeoResearchService(access);
const location = values.location as SeoMarket;
const limit = Number(values.limit);
const maxCostUsd = Number(values['max-cost']);

async function verifyMarkets(): Promise<void> {
  const authorization = `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`;
  const sources = {
    labs: 'dataforseo_labs/locations_and_languages',
    google_ads: 'keywords_data/google_ads/locations',
    serp: 'serp/google/locations',
  } as const;
  for (const [api, path] of Object.entries(sources) as Array<[keyof typeof sources, string]>) {
    const res = await fetch(`https://api.dataforseo.com/v3/${path}`, { headers: { authorization } });
    const body = (await res.json()) as {
      tasks?: Array<{ result?: Array<{ location_code: number; available_languages?: Array<{ language_code: string }> }> }>;
    };
    const locations = body.tasks?.[0]?.result ?? [];
    for (const [market, codes] of Object.entries(DATAFORSEO_MARKETS[api])) {
      const found = locations.find((l) => l.location_code === codes.locationCode);
      const offered = new Set((found?.available_languages ?? []).map((l) => l.language_code));
      const langs = Object.entries(codes.languages).map(([name, code]) =>
        `${name}=${code}${found && found.available_languages && !offered.has(code) ? ' (NOT OFFERED)' : ''}`,
      );
      console.log(`${api.padEnd(10)} ${market.padEnd(8)} ${found ? 'ok  ' : 'MISSING'} ${langs.join(', ')}`);
    }
  }
}

async function main(): Promise<void> {
  if (values['verify-markets']) await verifyMarkets();

  const balance = await research.providerBalance({});
  console.log(`balance: $${balance.balanceUsd ?? '?'} (spent today: $${balance.spentTodayUsd ?? '?'})`);

  const gap = await research.keywordGap({
    location,
    domain: values.target!,
    competitors: values.competitor!,
    limit,
    maxCostUsd,
  });
  console.log(
    `gap ${gap.domain} vs ${gap.competitors.join(', ')} in ${gap.market.location}/${gap.market.language}: ` +
      `${gap.rowsReturned} rows${gap.truncated ? ' (truncated)' : ''}${gap.noData ? ` — ${gap.reason}` : ''}`,
  );
  for (const r of gap.rows.slice(0, 20)) {
    const who = r.competitors.map((c) => `${c.domain}#${c.position ?? '?'}`).join(' ');
    console.log(`  ${String(r.volume ?? '-').padStart(7)}  ${r.keyword}  [${who}]`);
  }
  console.log(`cost: estimated $${gap.cost.estimatedUsd}, actual $${gap.cost.actualUsd}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
