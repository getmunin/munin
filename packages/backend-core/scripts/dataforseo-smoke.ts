import { parseArgs } from 'node:util';
import type { ConnectionRow } from '../src/modules/connectors/connectors.service.ts';
import { DataForSeoAdapter } from '../src/modules/seo/dataforseo.adapter.ts';
import {
  DATAFORSEO_LABS_LANGUAGES,
  DATAFORSEO_LANGUAGE_CODES,
  DATAFORSEO_LOCATION_CODES,
} from '../src/modules/seo/dataforseo.market-codes.ts';
import {
  SeoResearchService,
  type ResearchConnectorAccess,
} from '../src/modules/seo/seo-research.service.ts';
import { SEO_MARKETS } from '../src/modules/seo/seo-markets.ts';

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
const location = SEO_MARKETS.find((m) => m === values.location) ?? unknownLocation();

function unknownLocation(): never {
  console.error(`unknown --location ${values.location}; expected one of: ${SEO_MARKETS.join(', ')}`);
  process.exit(1);
}
const limit = Number(values.limit);
const maxCostUsd = Number(values['max-cost']);

async function verifyMarkets(): Promise<void> {
  const authorization = `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`;
  const get = async <T>(path: string): Promise<T[]> => {
    const res = await fetch(`https://api.dataforseo.com/v3/${path}`, { headers: { authorization } });
    const body = (await res.json()) as { tasks?: Array<{ result?: T[] | null }> };
    return body.tasks?.[0]?.result ?? [];
  };
  const labs = await get<{
    location_code: number;
    available_languages?: Array<{ language_code: string }>;
  }>('dataforseo_labs/locations_and_languages');
  const serp = new Set(
    (await get<{ location_code: number }>('serp/google/locations')).map((l) => l.location_code),
  );
  const ads = new Set(
    (await get<{ location_code: number }>('keywords_data/google_ads/locations')).map(
      (l) => l.location_code,
    ),
  );
  let problems = 0;
  for (const market of SEO_MARKETS) {
    const code = DATAFORSEO_LOCATION_CODES[market];
    const offered = new Set(
      (labs.find((l) => l.location_code === code)?.available_languages ?? []).map(
        (l) => l.language_code,
      ),
    );
    const expected = (DATAFORSEO_LABS_LANGUAGES[market] ?? []).map(
      (l) => DATAFORSEO_LANGUAGE_CODES[l].labs,
    );
    const issues = [
      serp.has(code) ? null : 'missing from SERP',
      ads.has(code) ? null : 'missing from Google Ads',
      ...expected.filter((c) => c && !offered.has(c)).map((c) => `Labs lacks ${c}`),
      ...[...offered].filter((c) => !expected.includes(c)).map((c) => `Labs also offers ${c}`),
    ].filter(Boolean);
    if (issues.length > 0) {
      problems += 1;
      console.log(`${market} (${code}): ${issues.join('; ')}`);
    }
  }
  console.log(`markets checked: ${SEO_MARKETS.length}, with differences: ${problems}`);
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
