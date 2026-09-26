import type { SeoLanguage, SeoMarket, SeoResearchOperation } from './seo-adapter.ts';

export type DataForSeoApi = 'labs' | 'google_ads' | 'serp';

export const API_BY_OPERATION: Record<Exclude<SeoResearchOperation, 'balance'>, DataForSeoApi> = {
  keyword_volume: 'google_ads',
  keyword_ideas: 'labs',
  ranked_keywords: 'labs',
  domain_intersection: 'labs',
  serp_snapshot: 'serp',
};

export interface DataForSeoMarketCodes {
  locationCode: number;
  languages: Partial<Record<SeoLanguage, string | null>>;
}

export const DATAFORSEO_MARKETS: Record<DataForSeoApi, Record<SeoMarket, DataForSeoMarketCodes>> = {
  labs: {
    norway: { locationCode: 2578, languages: { norwegian: 'nb' } },
    sweden: { locationCode: 2752, languages: { swedish: 'sv' } },
    denmark: { locationCode: 2208, languages: { danish: 'da' } },
    uk: { locationCode: 2826, languages: { english: 'en' } },
  },
  google_ads: {
    norway: { locationCode: 2578, languages: { norwegian: null } },
    sweden: { locationCode: 2752, languages: { swedish: null } },
    denmark: { locationCode: 2208, languages: { danish: null } },
    uk: { locationCode: 2826, languages: { english: null } },
  },
  serp: {
    norway: { locationCode: 2578, languages: { norwegian: 'no', english: 'en' } },
    sweden: { locationCode: 2752, languages: { swedish: 'sv', english: 'en' } },
    denmark: { locationCode: 2208, languages: { danish: 'da', english: 'en' } },
    uk: { locationCode: 2826, languages: { english: 'en' } },
  },
};

export function marketCodes(
  operation: Exclude<SeoResearchOperation, 'balance'>,
  market: SeoMarket,
  language: SeoLanguage,
): { locationCode: number; languageCode: string | null } | null {
  const entry = DATAFORSEO_MARKETS[API_BY_OPERATION[operation]][market];
  const languageCode = entry.languages[language];
  return languageCode === undefined ? null : { locationCode: entry.locationCode, languageCode };
}
