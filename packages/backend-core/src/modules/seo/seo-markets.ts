export const SEO_REGIONS = ['europe', 'north_america'] as const;

export type SeoRegion = (typeof SEO_REGIONS)[number];

export const SEO_LANGUAGES = [
  'albanian',
  'armenian',
  'azerbaijani',
  'bosnian',
  'bulgarian',
  'catalan',
  'croatian',
  'czech',
  'danish',
  'dutch',
  'english',
  'estonian',
  'finnish',
  'french',
  'georgian',
  'german',
  'greek',
  'haitian_creole',
  'hungarian',
  'icelandic',
  'irish',
  'italian',
  'latvian',
  'lithuanian',
  'macedonian',
  'maltese',
  'norwegian',
  'polish',
  'portuguese',
  'romanian',
  'russian',
  'serbian',
  'slovak',
  'slovenian',
  'spanish',
  'swedish',
  'turkish',
  'ukrainian',
  'welsh',
] as const;

export type SeoLanguage = (typeof SEO_LANGUAGES)[number];

export interface SeoMarketInfo {
  label: string;
  countryCode: string;
  region: SeoRegion;
  languages: readonly SeoLanguage[];
}

export const SEO_MARKET_INFO = {
  albania: {
    label: 'Albania',
    countryCode: 'AL',
    region: 'europe',
    languages: ['albanian'],
  },
  andorra: {
    label: 'Andorra',
    countryCode: 'AD',
    region: 'europe',
    languages: ['catalan', 'spanish', 'french'],
  },
  antigua_and_barbuda: {
    label: 'Antigua and Barbuda',
    countryCode: 'AG',
    region: 'north_america',
    languages: ['english'],
  },
  armenia: {
    label: 'Armenia',
    countryCode: 'AM',
    region: 'europe',
    languages: ['armenian'],
  },
  austria: {
    label: 'Austria',
    countryCode: 'AT',
    region: 'europe',
    languages: ['german'],
  },
  azerbaijan: {
    label: 'Azerbaijan',
    countryCode: 'AZ',
    region: 'europe',
    languages: ['azerbaijani'],
  },
  bahamas: {
    label: 'The Bahamas',
    countryCode: 'BS',
    region: 'north_america',
    languages: ['english'],
  },
  barbados: {
    label: 'Barbados',
    countryCode: 'BB',
    region: 'north_america',
    languages: ['english'],
  },
  belgium: {
    label: 'Belgium',
    countryCode: 'BE',
    region: 'europe',
    languages: ['dutch', 'french', 'german'],
  },
  belize: {
    label: 'Belize',
    countryCode: 'BZ',
    region: 'north_america',
    languages: ['english', 'spanish'],
  },
  bosnia_and_herzegovina: {
    label: 'Bosnia and Herzegovina',
    countryCode: 'BA',
    region: 'europe',
    languages: ['bosnian'],
  },
  bulgaria: {
    label: 'Bulgaria',
    countryCode: 'BG',
    region: 'europe',
    languages: ['bulgarian'],
  },
  canada: {
    label: 'Canada',
    countryCode: 'CA',
    region: 'north_america',
    languages: ['english', 'french'],
  },
  caribbean_netherlands: {
    label: 'Caribbean Netherlands',
    countryCode: 'BQ',
    region: 'north_america',
    languages: ['dutch'],
  },
  costa_rica: {
    label: 'Costa Rica',
    countryCode: 'CR',
    region: 'north_america',
    languages: ['spanish'],
  },
  croatia: {
    label: 'Croatia',
    countryCode: 'HR',
    region: 'europe',
    languages: ['croatian'],
  },
  curacao: {
    label: 'Curacao',
    countryCode: 'CW',
    region: 'north_america',
    languages: ['dutch'],
  },
  cyprus: {
    label: 'Cyprus',
    countryCode: 'CY',
    region: 'europe',
    languages: ['greek', 'english'],
  },
  czechia: {
    label: 'Czechia',
    countryCode: 'CZ',
    region: 'europe',
    languages: ['czech'],
  },
  denmark: {
    label: 'Denmark',
    countryCode: 'DK',
    region: 'europe',
    languages: ['danish'],
  },
  dominica: {
    label: 'Dominica',
    countryCode: 'DM',
    region: 'north_america',
    languages: ['english'],
  },
  dominican_republic: {
    label: 'Dominican Republic',
    countryCode: 'DO',
    region: 'north_america',
    languages: ['spanish'],
  },
  el_salvador: {
    label: 'El Salvador',
    countryCode: 'SV',
    region: 'north_america',
    languages: ['spanish'],
  },
  estonia: {
    label: 'Estonia',
    countryCode: 'EE',
    region: 'europe',
    languages: ['estonian'],
  },
  finland: {
    label: 'Finland',
    countryCode: 'FI',
    region: 'europe',
    languages: ['finnish', 'swedish'],
  },
  france: {
    label: 'France',
    countryCode: 'FR',
    region: 'europe',
    languages: ['french'],
  },
  georgia: {
    label: 'Georgia',
    countryCode: 'GE',
    region: 'europe',
    languages: ['georgian'],
  },
  germany: {
    label: 'Germany',
    countryCode: 'DE',
    region: 'europe',
    languages: ['german'],
  },
  greece: {
    label: 'Greece',
    countryCode: 'GR',
    region: 'europe',
    languages: ['greek', 'english'],
  },
  grenada: {
    label: 'Grenada',
    countryCode: 'GD',
    region: 'north_america',
    languages: ['english'],
  },
  guatemala: {
    label: 'Guatemala',
    countryCode: 'GT',
    region: 'north_america',
    languages: ['spanish'],
  },
  guernsey: {
    label: 'Guernsey',
    countryCode: 'GG',
    region: 'europe',
    languages: ['english'],
  },
  haiti: {
    label: 'Haiti',
    countryCode: 'HT',
    region: 'north_america',
    languages: ['french', 'haitian_creole'],
  },
  honduras: {
    label: 'Honduras',
    countryCode: 'HN',
    region: 'north_america',
    languages: ['spanish'],
  },
  hungary: {
    label: 'Hungary',
    countryCode: 'HU',
    region: 'europe',
    languages: ['hungarian'],
  },
  iceland: {
    label: 'Iceland',
    countryCode: 'IS',
    region: 'europe',
    languages: ['icelandic'],
  },
  ireland: {
    label: 'Ireland',
    countryCode: 'IE',
    region: 'europe',
    languages: ['english', 'irish'],
  },
  isle_of_man: {
    label: 'Isle of Man',
    countryCode: 'IM',
    region: 'europe',
    languages: ['english'],
  },
  italy: {
    label: 'Italy',
    countryCode: 'IT',
    region: 'europe',
    languages: ['italian'],
  },
  jamaica: {
    label: 'Jamaica',
    countryCode: 'JM',
    region: 'north_america',
    languages: ['english'],
  },
  jersey: {
    label: 'Jersey',
    countryCode: 'JE',
    region: 'europe',
    languages: ['english'],
  },
  latvia: {
    label: 'Latvia',
    countryCode: 'LV',
    region: 'europe',
    languages: ['latvian'],
  },
  liechtenstein: {
    label: 'Liechtenstein',
    countryCode: 'LI',
    region: 'europe',
    languages: ['german'],
  },
  lithuania: {
    label: 'Lithuania',
    countryCode: 'LT',
    region: 'europe',
    languages: ['lithuanian'],
  },
  luxembourg: {
    label: 'Luxembourg',
    countryCode: 'LU',
    region: 'europe',
    languages: ['french', 'german'],
  },
  malta: {
    label: 'Malta',
    countryCode: 'MT',
    region: 'europe',
    languages: ['english', 'maltese'],
  },
  mexico: {
    label: 'Mexico',
    countryCode: 'MX',
    region: 'north_america',
    languages: ['spanish'],
  },
  moldova: {
    label: 'Moldova',
    countryCode: 'MD',
    region: 'europe',
    languages: ['romanian'],
  },
  monaco: {
    label: 'Monaco',
    countryCode: 'MC',
    region: 'europe',
    languages: ['french'],
  },
  montenegro: {
    label: 'Montenegro',
    countryCode: 'ME',
    region: 'europe',
    languages: ['serbian'],
  },
  netherlands: {
    label: 'Netherlands',
    countryCode: 'NL',
    region: 'europe',
    languages: ['dutch'],
  },
  nicaragua: {
    label: 'Nicaragua',
    countryCode: 'NI',
    region: 'north_america',
    languages: ['spanish'],
  },
  north_macedonia: {
    label: 'North Macedonia',
    countryCode: 'MK',
    region: 'europe',
    languages: ['macedonian'],
  },
  norway: {
    label: 'Norway',
    countryCode: 'NO',
    region: 'europe',
    languages: ['norwegian'],
  },
  panama: {
    label: 'Panama',
    countryCode: 'PA',
    region: 'north_america',
    languages: ['spanish'],
  },
  poland: {
    label: 'Poland',
    countryCode: 'PL',
    region: 'europe',
    languages: ['polish'],
  },
  portugal: {
    label: 'Portugal',
    countryCode: 'PT',
    region: 'europe',
    languages: ['portuguese'],
  },
  romania: {
    label: 'Romania',
    countryCode: 'RO',
    region: 'europe',
    languages: ['romanian'],
  },
  saint_kitts_and_nevis: {
    label: 'Saint Kitts and Nevis',
    countryCode: 'KN',
    region: 'north_america',
    languages: ['english'],
  },
  saint_lucia: {
    label: 'Saint Lucia',
    countryCode: 'LC',
    region: 'north_america',
    languages: ['english'],
  },
  saint_martin: {
    label: 'Saint Martin',
    countryCode: 'MF',
    region: 'north_america',
    languages: ['french'],
  },
  saint_pierre_and_miquelon: {
    label: 'Saint Pierre and Miquelon',
    countryCode: 'PM',
    region: 'north_america',
    languages: ['french'],
  },
  saint_vincent_and_the_grenadines: {
    label: 'Saint Vincent and the Grenadines',
    countryCode: 'VC',
    region: 'north_america',
    languages: ['english'],
  },
  san_marino: {
    label: 'San Marino',
    countryCode: 'SM',
    region: 'europe',
    languages: ['italian'],
  },
  serbia: {
    label: 'Serbia',
    countryCode: 'RS',
    region: 'europe',
    languages: ['serbian'],
  },
  sint_maarten: {
    label: 'Sint Maarten',
    countryCode: 'SX',
    region: 'north_america',
    languages: ['dutch', 'english'],
  },
  slovakia: {
    label: 'Slovakia',
    countryCode: 'SK',
    region: 'europe',
    languages: ['slovak'],
  },
  slovenia: {
    label: 'Slovenia',
    countryCode: 'SI',
    region: 'europe',
    languages: ['slovenian'],
  },
  spain: {
    label: 'Spain',
    countryCode: 'ES',
    region: 'europe',
    languages: ['spanish'],
  },
  sweden: {
    label: 'Sweden',
    countryCode: 'SE',
    region: 'europe',
    languages: ['swedish'],
  },
  switzerland: {
    label: 'Switzerland',
    countryCode: 'CH',
    region: 'europe',
    languages: ['german', 'french', 'italian'],
  },
  trinidad_and_tobago: {
    label: 'Trinidad and Tobago',
    countryCode: 'TT',
    region: 'north_america',
    languages: ['english'],
  },
  turkey: {
    label: 'Turkiye',
    countryCode: 'TR',
    region: 'europe',
    languages: ['turkish'],
  },
  ukraine: {
    label: 'Ukraine',
    countryCode: 'UA',
    region: 'europe',
    languages: ['ukrainian', 'russian'],
  },
  united_kingdom: {
    label: 'United Kingdom',
    countryCode: 'GB',
    region: 'europe',
    languages: ['english', 'welsh'],
  },
  united_states: {
    label: 'United States',
    countryCode: 'US',
    region: 'north_america',
    languages: ['english', 'spanish'],
  },
  vatican_city: {
    label: 'Vatican City',
    countryCode: 'VA',
    region: 'europe',
    languages: ['italian'],
  },
} as const satisfies Record<string, SeoMarketInfo>;

export type SeoMarket = keyof typeof SEO_MARKET_INFO;

export const SEO_MARKETS = Object.keys(SEO_MARKET_INFO) as [SeoMarket, ...SeoMarket[]];

export function marketLanguages(market: SeoMarket): readonly SeoLanguage[] {
  return SEO_MARKET_INFO[market].languages;
}

export function defaultLanguage(market: SeoMarket): SeoLanguage {
  return SEO_MARKET_INFO[market].languages[0];
}
