export const FALLBACK_LOCALES = [
  'en',
  'nb',
  'da',
  'sv',
  'fi',
  'is',
  'de',
  'fr',
  'es',
  'it',
  'pt',
  'nl',
  'pl',
] as const;

export type FallbackLocale = (typeof FALLBACK_LOCALES)[number];

const SUPPORTED = new Set<string>(FALLBACK_LOCALES);
const DEFAULT_LOCALE: FallbackLocale = 'en';

export const FALLBACK_GREET: Record<FallbackLocale, string> = {
  en: 'Hi there. How can we help?',
  nb: 'Hei. Hva kan vi hjelpe deg med?',
  da: 'Hej. Hvad kan vi hjælpe med?',
  sv: 'Hej. Vad kan vi hjälpa till med?',
  fi: 'Hei. Miten voimme auttaa?',
  is: 'Halló. Hvernig getum við hjálpað?',
  de: 'Hallo. Wie können wir helfen?',
  fr: 'Bonjour. Comment pouvons-nous vous aider ?',
  es: 'Hola. ¿En qué podemos ayudarte?',
  it: 'Ciao. Come possiamo aiutarti?',
  pt: 'Olá. Como podemos ajudar?',
  nl: 'Hallo. Hoe kunnen we helpen?',
  pl: 'Cześć. W czym możemy pomóc?',
};

export const FALLBACK_HANDOVER: Record<FallbackLocale, string> = {
  en: "I'm having trouble responding right now. A teammate will follow up shortly.",
  nb: 'Jeg får ikke svart akkurat nå. En kollega følger opp snart.',
  da: 'Jeg kan ikke svare lige nu. En kollega følger op snart.',
  sv: 'Jag kan inte svara just nu. En kollega följer upp snart.',
  fi: 'En pysty vastaamaan juuri nyt. Tiimimme jäsen ottaa pian yhteyttä.',
  is: 'Ég get ekki svarað akkúrat núna. Samstarfsmaður mun hafa samband fljótlega.',
  de: 'Ich kann gerade nicht antworten. Ein Teammitglied meldet sich in Kürze.',
  fr: "Je n'arrive pas à répondre pour le moment. Un membre de l'équipe vous recontactera sous peu.",
  es: 'No puedo responder ahora mismo. Un compañero te contactará en breve.',
  it: 'Ho difficoltà a rispondere in questo momento. Un membro del team ti contatterà a breve.',
  pt: 'Não consigo responder neste momento. Um colega vai contactá-lo em breve.',
  nl: 'Het lukt me nu niet om te reageren. Een teamlid neemt zo contact op.',
  pl: 'Nie mogę teraz odpowiedzieć. Ktoś z zespołu skontaktuje się wkrótce.',
};

export function pickFallback(locale: string | null | undefined): FallbackLocale {
  if (!locale) return DEFAULT_LOCALE;
  const short = locale.toLowerCase().split('-')[0] ?? '';
  return SUPPORTED.has(short) ? (short as FallbackLocale) : DEFAULT_LOCALE;
}
