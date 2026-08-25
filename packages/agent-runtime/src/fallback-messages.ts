export const FALLBACK_LOCALES = [
  'en',
  'nb',
  'nn',
  'da',
  'sv',
  'fi',
  'is',
  'et',
  'lv',
  'lt',
  'de',
  'fr',
  'es',
  'it',
  'pt',
  'nl',
  'pl',
  'cs',
  'sk',
  'hu',
  'ro',
] as const;

export type FallbackLocale = (typeof FALLBACK_LOCALES)[number];

const SUPPORTED = new Set<string>(FALLBACK_LOCALES);
const DEFAULT_LOCALE: FallbackLocale = 'en';

const LOCALE_ALIASES: Record<string, FallbackLocale> = {
  no: 'nb',
  nob: 'nb',
  nor: 'nb',
  nno: 'nn',
};

export const FALLBACK_GREET: Record<FallbackLocale, string> = {
  en: 'Hi there. How can we help?',
  nb: 'Hei. Hva kan vi hjelpe deg med?',
  nn: 'Hei. Kva kan vi hjelpe deg med?',
  da: 'Hej. Hvad kan vi hjælpe med?',
  sv: 'Hej. Vad kan vi hjälpa till med?',
  fi: 'Hei. Miten voimme auttaa?',
  is: 'Halló. Hvernig getum við hjálpað?',
  et: 'Tere. Kuidas saame aidata?',
  lv: 'Sveiki. Kā varam palīdzēt?',
  lt: 'Sveiki. Kaip galime padėti?',
  de: 'Hallo. Wie können wir helfen?',
  fr: 'Bonjour. Comment pouvons-nous vous aider ?',
  es: 'Hola. ¿En qué podemos ayudarte?',
  it: 'Ciao. Come possiamo aiutarti?',
  pt: 'Olá. Como podemos ajudar?',
  nl: 'Hallo. Hoe kunnen we helpen?',
  pl: 'Cześć. W czym możemy pomóc?',
  cs: 'Dobrý den. Jak můžeme pomoct?',
  sk: 'Dobrý deň. Ako môžeme pomôcť?',
  hu: 'Üdv. Miben segíthetünk?',
  ro: 'Bună. Cu ce vă putem ajuta?',
};

export const FALLBACK_HANDOVER: Record<FallbackLocale, string> = {
  en: "I'm having trouble responding right now. A teammate will follow up shortly.",
  nb: 'Jeg får ikke svart akkurat nå. En kollega følger opp snart.',
  nn: 'Eg får ikkje svart akkurat no. Ein kollega følgjer opp snart.',
  da: 'Jeg kan ikke svare lige nu. En kollega følger op snart.',
  sv: 'Jag kan inte svara just nu. En kollega följer upp snart.',
  fi: 'En pysty vastaamaan juuri nyt. Tiimimme jäsen ottaa pian yhteyttä.',
  is: 'Ég get ekki svarað akkúrat núna. Samstarfsmaður mun hafa samband fljótlega.',
  et: 'Ma ei saa praegu vastata. Kolleeg võtab varsti ühendust.',
  lv: 'Šobrīd nevaru atbildēt. Kolēģis drīz sazināsies.',
  lt: 'Šiuo metu negaliu atsakyti. Kolega greitai susisieks.',
  de: 'Ich kann gerade nicht antworten. Ein Teammitglied meldet sich in Kürze.',
  fr: "Je n'arrive pas à répondre pour le moment. Un membre de l'équipe vous recontactera sous peu.",
  es: 'No puedo responder ahora mismo. Un compañero te contactará en breve.',
  it: 'Ho difficoltà a rispondere in questo momento. Un membro del team ti contatterà a breve.',
  pt: 'Não consigo responder neste momento. Um colega vai contactá-lo em breve.',
  nl: 'Het lukt me nu niet om te reageren. Een teamlid neemt zo contact op.',
  pl: 'Nie mogę teraz odpowiedzieć. Ktoś z zespołu skontaktuje się wkrótce.',
  cs: 'Teď nemůžu odpovědět. Kolega se vám ozve zakrátko.',
  sk: 'Teraz nemôžem odpovedať. Kolega sa vám ozve zakrátko.',
  hu: 'Most nem tudok válaszolni. Egy kollégám hamarosan jelentkezik.',
  ro: 'Nu pot răspunde chiar acum. Un coleg vă va contacta în scurt timp.',
};

export function pickFallback(locale: string | null | undefined): FallbackLocale {
  if (!locale) return DEFAULT_LOCALE;
  const short = locale.toLowerCase().split('-')[0] ?? '';
  if (!short) return DEFAULT_LOCALE;
  const aliased = LOCALE_ALIASES[short];
  if (aliased) return aliased;
  return SUPPORTED.has(short) ? (short as FallbackLocale) : DEFAULT_LOCALE;
}
