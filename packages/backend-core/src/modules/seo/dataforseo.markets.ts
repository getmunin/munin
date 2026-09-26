import type { SeoResearchOperation } from './seo-adapter.ts';
import { marketLanguages, type SeoLanguage, type SeoMarket } from './seo-markets.ts';
import {
  DATAFORSEO_LABS_LANGUAGES,
  DATAFORSEO_LANGUAGE_CODES,
  DATAFORSEO_LOCATION_CODES,
} from './dataforseo.market-codes.ts';

export type DataForSeoApi = 'labs' | 'google_ads' | 'serp';

export type DataForSeoMarketOperation = Exclude<SeoResearchOperation, 'balance'>;

export const API_BY_OPERATION: Record<DataForSeoMarketOperation, DataForSeoApi> = {
  keyword_volume: 'google_ads',
  keyword_ideas: 'labs',
  ranked_keywords: 'labs',
  domain_intersection: 'labs',
  serp_snapshot: 'serp',
};

export function dataForSeoLanguages(
  operation: DataForSeoMarketOperation,
  market: SeoMarket,
): readonly SeoLanguage[] {
  const native = marketLanguages(market);
  switch (API_BY_OPERATION[operation]) {
    case 'labs':
      return DATAFORSEO_LABS_LANGUAGES[market] ?? [];
    case 'google_ads':
      return native;
    case 'serp':
      return native.includes('english') ? native : [...native, 'english'];
  }
}

export function marketCodes(
  operation: DataForSeoMarketOperation,
  market: SeoMarket,
  language: SeoLanguage,
): { locationCode: number; languageCode: string | null } | null {
  if (!dataForSeoLanguages(operation, market).includes(language)) return null;
  const locationCode = DATAFORSEO_LOCATION_CODES[market];
  const codes = DATAFORSEO_LANGUAGE_CODES[language];
  switch (API_BY_OPERATION[operation]) {
    case 'labs':
      return codes.labs ? { locationCode, languageCode: codes.labs } : null;
    case 'google_ads':
      return { locationCode, languageCode: null };
    case 'serp':
      return { locationCode, languageCode: codes.serp };
  }
}
