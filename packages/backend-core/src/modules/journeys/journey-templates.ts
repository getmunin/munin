export const TEMPLATE_LOCALES = ['nb', 'sv', 'en'] as const;
export type TemplateLocale = (typeof TEMPLATE_LOCALES)[number];

export interface TemplateParam {
  key: string;
  description: string;
  required: boolean;
}

export interface JourneyTemplate {
  slug: string;
  locale: string;
  title: string;
  description: string;
  tags: string[];
  params: TemplateParam[];
  spec: Record<string, unknown>;
  builtIn: boolean;
}

type Copy = Record<string, { subject: string; body: string }>;

const SEGMENT: TemplateParam = {
  key: 'segmentId',
  description: 'Segment of people who may enter (crm_list_segments). Members need a recorded lawful basis.',
  required: true,
};

const TIMEZONE: Record<TemplateLocale, string> = { nb: 'Europe/Oslo', sv: 'Europe/Stockholm', en: 'Europe/London' };

const email = (id: string, copy: Copy, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'message',
  channel: 'email',
  content: { subject: copy[id]!.subject, body: copy[id]!.body },
  approval: 'auto',
  ...extra,
});

const settings = (locale: TemplateLocale, extra: Record<string, unknown> = {}) => ({
  timezone: TIMEZONE[locale],
  quietHours: '20:00-08:00',
  frequencyCapPerWeek: 3,
  ...extra,
});

interface TemplateDef {
  slug: string;
  tags: string[];
  params: TemplateParam[];
  text: Record<TemplateLocale, { title: string; description: string; copy: Copy }>;
  spec: (copy: Copy, locale: TemplateLocale) => Record<string, unknown>;
}

const DEFS: TemplateDef[] = [
  {
    slug: 'inbound-lead',
    tags: ['b2b', 'lead'],
    params: [SEGMENT],
    text: {
      en: {
        title: 'Inbound lead',
        description: 'A new contact from a form or the chat widget: an agent qualifies them from what they told you, qualified leads are flagged for sales, the rest get a helpful follow-up.',
        copy: { nurture: { subject: 'Thanks for getting in touch', body: 'Hi {{name}}, thanks for reaching out. Reply with what you are working on and we will point you to the best place to start.' } },
      },
      nb: {
        title: 'Innkommende lead',
        description: 'En ny kontakt fra skjema eller chat: en agent kvalifiserer ut fra det de har fortalt, kvalifiserte flagges til salg, resten får en nyttig oppfølging.',
        copy: { nurture: { subject: 'Takk for at du tok kontakt', body: 'Hei {{name}}, takk for at du tok kontakt. Svar med hva du jobber med, så viser vi deg hvor det lønner seg å begynne.' } },
      },
      sv: {
        title: 'Inkommande lead',
        description: 'En ny kontakt från formulär eller chatt: en agent kvalificerar utifrån vad de berättat, kvalificerade flaggas till sälj, övriga får en hjälpsam uppföljning.',
        copy: { nurture: { subject: 'Tack för att du hörde av dig', body: 'Hej {{name}}, tack för att du hörde av dig. Svara med vad du jobbar med, så visar vi var det lönar sig att börja.' } },
      },
    },
    spec: (copy, locale) => ({
      entry: { trigger: { type: 'event', event: 'crm.contact.created' }, segmentId: '{{param:segmentId}}' },
      goal: { event: 'crm.deal.created', windowDays: 30 },
      settings: settings(locale),
      start: 'qualify',
      nodes: [
        {
          id: 'qualify',
          type: 'agent',
          mode: 'decide',
          instructions: 'Does this contact match our ideal customer and show buying intent? Qualified means a plausible team or company fit and a concrete need.',
          edges: { qualified: 'flag_sales', nurture: 'nurture' },
          fallback: 'nurture',
          inputs: ['contact', 'company', 'thread'],
        },
        { id: 'flag_sales', type: 'action', action: 'crm.add_tag', params: { tag: 'sales-qualified' }, next: 'done' },
        email('nurture', copy, { next: 'done' }),
        { id: 'done', type: 'exit' },
      ],
    }),
  },
  {
    slug: 'trial-onboarding',
    tags: ['saas', 'trial'],
    params: [SEGMENT],
    text: {
      en: {
        title: 'Trial onboarding',
        description: 'Welcome every new trial user, check after five working days whether they invited a colleague, flag decision-makers for sales and offer help to the rest.',
        copy: {
          welcome: { subject: 'Welcome to your trial', body: 'Hi {{name}}, here are three things to try today.' },
          offer_help: { subject: 'Can we help you get started?', body: 'Hi {{name}}, most teams get more out of a trial once a colleague joins. Want a hand setting it up?' },
        },
      },
      nb: {
        title: 'Prøveperiode',
        description: 'Ønsk hver ny prøvebruker velkommen, sjekk etter fem arbeidsdager om de har invitert en kollega, flagg beslutningstakere til salg og tilby resten hjelp.',
        copy: {
          welcome: { subject: 'Velkommen til prøveperioden', body: 'Hei {{name}}, her er tre ting du kan prøve i dag.' },
          offer_help: { subject: 'Kan vi hjelpe deg i gang?', body: 'Hei {{name}}, de fleste team får mer ut av prøveperioden når en kollega er med. Vil du ha hjelp til å komme i gang?' },
        },
      },
      sv: {
        title: 'Provperiod',
        description: 'Välkomna varje ny provanvändare, kontrollera efter fem arbetsdagar om de bjudit in en kollega, flagga beslutsfattare till sälj och erbjud övriga hjälp.',
        copy: {
          welcome: { subject: 'Välkommen till din provperiod', body: 'Hej {{name}}, här är tre saker att prova i dag.' },
          offer_help: { subject: 'Kan vi hjälpa dig igång?', body: 'Hej {{name}}, de flesta team får ut mer av provperioden när en kollega är med. Vill du ha hjälp att komma igång?' },
        },
      },
    },
    spec: (copy, locale) => ({
      entry: { trigger: { type: 'event', event: 'trial.started' }, segmentId: '{{param:segmentId}}' },
      goal: { event: 'subscription.started', windowDays: 30 },
      exit: { idleDays: 30, on: [] },
      settings: settings(locale, { holdoutPct: 10 }),
      start: 'welcome',
      nodes: [
        email('welcome', copy, { next: 'wait5' }),
        { id: 'wait5', type: 'wait', duration: 'P5D', validDays: ['mon', 'tue', 'wed', 'thu', 'fri'], validHours: '09:00-16:00', next: 'invited' },
        { id: 'invited', type: 'branch', rules: [{ if: { event: 'teammate.invited', since: 'entry' }, next: 'done' }], default: 'decision_maker' },
        {
          id: 'decision_maker',
          type: 'branch',
          rules: [{ if: { field: 'contact.title', op: 'in', value: ['CEO', 'CTO', 'Founder', 'Daglig leder', 'VD'] }, next: 'flag_sales' }],
          default: 'offer_help',
        },
        { id: 'flag_sales', type: 'action', action: 'crm.add_tag', params: { tag: 'trial-sales-lead' }, next: 'done' },
        email('offer_help', copy, { next: 'done', onReply: 'replied' }),
        { id: 'replied', type: 'action', action: 'crm.log_activity', params: { subject: 'Replied to trial help email' }, next: 'done' },
        { id: 'done', type: 'exit' },
      ],
    }),
  },
  {
    slug: 'webinar',
    tags: ['events'],
    params: [SEGMENT],
    text: {
      en: {
        title: 'Webinar',
        description: 'Confirm the registration, remind the day before, then follow up attendees and no-shows differently. Expects webinar.registered with properties.startsAt, and webinar.attended.',
        copy: {
          confirm: { subject: 'You are registered', body: 'Hi {{name}}, your seat is booked. We will send a reminder the day before.' },
          remind: { subject: 'See you tomorrow', body: 'Hi {{name}}, a quick reminder that the webinar is tomorrow.' },
          thanks: { subject: 'Thanks for joining', body: 'Hi {{name}}, thanks for joining. Here is the recording and the next step we talked about.' },
          missed: { subject: 'Sorry we missed you', body: 'Hi {{name}}, we missed you — here is the recording to watch when it suits you.' },
        },
      },
      nb: {
        title: 'Webinar',
        description: 'Bekreft påmeldingen, minn på dagen før, og følg opp deltakere og de som ikke møtte ulikt. Forventer webinar.registered med properties.startsAt, og webinar.attended.',
        copy: {
          confirm: { subject: 'Du er påmeldt', body: 'Hei {{name}}, plassen din er reservert. Vi sender en påminnelse dagen før.' },
          remind: { subject: 'Vi ses i morgen', body: 'Hei {{name}}, en kort påminnelse om at webinaret er i morgen.' },
          thanks: { subject: 'Takk for at du var med', body: 'Hei {{name}}, takk for at du var med. Her er opptaket og neste steg vi snakket om.' },
          missed: { subject: 'Vi savnet deg', body: 'Hei {{name}}, vi savnet deg — her er opptaket, så kan du se det når det passer.' },
        },
      },
      sv: {
        title: 'Webbinarium',
        description: 'Bekräfta anmälan, påminn dagen innan och följ upp deltagare och de som uteblev på olika sätt. Förväntar webinar.registered med properties.startsAt, och webinar.attended.',
        copy: {
          confirm: { subject: 'Du är anmäld', body: 'Hej {{name}}, din plats är bokad. Vi skickar en påminnelse dagen innan.' },
          remind: { subject: 'Vi ses i morgon', body: 'Hej {{name}}, en kort påminnelse om att webbinariet är i morgon.' },
          thanks: { subject: 'Tack för att du var med', body: 'Hej {{name}}, tack för att du var med. Här är inspelningen och nästa steg vi pratade om.' },
          missed: { subject: 'Vi saknade dig', body: 'Hej {{name}}, vi saknade dig — här är inspelningen att se när det passar.' },
        },
      },
    },
    spec: (copy, locale) => ({
      entry: { trigger: { type: 'event', event: 'webinar.registered' }, segmentId: '{{param:segmentId}}', reentry: 'once_at_a_time' },
      goal: { event: 'webinar.attended', windowDays: 14, exitOnGoal: false },
      settings: settings(locale),
      start: 'confirm',
      nodes: [
        email('confirm', copy, { class: 'transactional', next: 'until_eve' }),
        { id: 'until_eve', type: 'wait', untilField: { field: 'context.trigger.properties.startsAt', offset: '-P1D' }, next: 'remind' },
        email('remind', copy, { class: 'transactional', next: 'attended' }),
        { id: 'attended', type: 'wait_for', event: 'webinar.attended', timeout: 'P2D', next: 'thanks', onTimeout: 'missed' },
        email('thanks', copy, { next: 'done' }),
        email('missed', copy, { next: 'done' }),
        { id: 'done', type: 'exit' },
      ],
    }),
  },
  {
    slug: 'win-back',
    tags: ['retention'],
    params: [SEGMENT],
    text: {
      en: {
        title: 'Win-back',
        description: 'A week after a subscription is cancelled, ask what would bring them back; end when they subscribe again.',
        copy: { win_back: { subject: 'Anything we could do better?', body: 'Hi {{name}}, we are sorry to see you go. If something was missing, reply and tell us — it goes straight to the team.' } },
      },
      nb: {
        title: 'Vinn tilbake',
        description: 'En uke etter at et abonnement er sagt opp, spør hva som skal til for å komme tilbake; avslutt når de abonnerer igjen.',
        copy: { win_back: { subject: 'Noe vi kunne gjort bedre?', body: 'Hei {{name}}, leit å se deg gå. Manglet det noe, så svar gjerne og fortell oss det — det går rett til teamet.' } },
      },
      sv: {
        title: 'Vinn tillbaka',
        description: 'En vecka efter att en prenumeration sagts upp, fråga vad som skulle få dem att komma tillbaka; avsluta när de prenumererar igen.',
        copy: { win_back: { subject: 'Något vi kunde gjort bättre?', body: 'Hej {{name}}, tråkigt att se dig gå. Saknades något, svara gärna och berätta — det går direkt till teamet.' } },
      },
    },
    spec: (copy, locale) => ({
      entry: { trigger: { type: 'event', event: 'subscription.cancelled' }, segmentId: '{{param:segmentId}}' },
      goal: { event: 'subscription.started', windowDays: 60 },
      exit: { on: [{ event: 'subscription.started' }] },
      settings: settings(locale),
      start: 'wait7',
      nodes: [
        { id: 'wait7', type: 'wait', duration: 'P7D', validDays: ['tue', 'wed', 'thu'], validHours: '09:00-15:00', next: 'win_back' },
        email('win_back', copy, { next: 'done', onReply: 'listen' }),
        { id: 'listen', type: 'action', action: 'crm.log_activity', params: { subject: 'Replied to win-back email' }, next: 'done' },
        { id: 'done', type: 'exit' },
      ],
    }),
  },
  {
    slug: 'csat-after-conversation',
    tags: ['support', 'feedback'],
    params: [SEGMENT],
    text: {
      en: {
        title: 'Satisfaction after a conversation',
        description: 'Two hours after a support conversation closes, ask how it went. An agent reads the answer: unhappy customers become a follow-up task, happy ones get a review request.',
        copy: {
          ask: { subject: 'How did we do?', body: 'Hi {{name}}, how did we do with your question? Just reply with a word or two.' },
          review: { subject: 'Would you share that?', body: 'Hi {{name}}, glad to hear it! Would you mind sharing it in a short review?' },
        },
      },
      nb: {
        title: 'Tilfredshet etter samtale',
        description: 'To timer etter at en supportsamtale lukkes, spør hvordan det gikk. En agent leser svaret: misfornøyde blir en oppfølgingsoppgave, fornøyde får en forespørsel om omtale.',
        copy: {
          ask: { subject: 'Hvordan gikk det?', body: 'Hei {{name}}, hvordan synes du vi hjalp deg? Svar gjerne med et par ord.' },
          review: { subject: 'Vil du dele det?', body: 'Hei {{name}}, så hyggelig å høre! Vil du dele det i en kort omtale?' },
        },
      },
      sv: {
        title: 'Nöjdhet efter samtal',
        description: 'Två timmar efter att ett supportärende stängts, fråga hur det gick. En agent läser svaret: missnöjda blir en uppföljning, nöjda får en fråga om recension.',
        copy: {
          ask: { subject: 'Hur gick det?', body: 'Hej {{name}}, hur tycker du att vi hjälpte dig? Svara gärna med ett par ord.' },
          review: { subject: 'Vill du dela det?', body: 'Hej {{name}}, vad roligt att höra! Vill du dela det i en kort recension?' },
        },
      },
    },
    spec: (copy, locale) => ({
      entry: { trigger: { type: 'event', event: 'conversation.status_changed', where: { status: 'closed' } }, segmentId: '{{param:segmentId}}' },
      goal: { event: 'review.posted', windowDays: 14 },
      settings: settings(locale, { cooldownHoursAfterConversation: 0 }),
      start: 'wait2h',
      nodes: [
        { id: 'wait2h', type: 'wait', duration: 'PT2H', next: 'ask' },
        email('ask', copy, { onReply: 'read_answer' }),
        {
          id: 'read_answer',
          type: 'agent',
          mode: 'decide',
          instructions: 'Is the customer happy, unhappy or neutral about how we handled their conversation?',
          edges: { happy: 'review', unhappy: 'follow_up', neutral: 'done' },
          fallback: 'neutral',
          inputs: ['reply', 'thread'],
        },
        email('review', copy, { next: 'done' }),
        { id: 'follow_up', type: 'action', action: 'crm.log_activity', params: { subject: 'Unhappy after a support conversation — follow up' }, next: 'done' },
        { id: 'done', type: 'exit' },
      ],
    }),
  },
  {
    slug: 'sunset-unengaged',
    tags: ['hygiene', 'deliverability'],
    params: [{ ...SEGMENT, description: 'Segment of people who have not engaged for a long time (for example not contacted or active for 180 days).' }],
    text: {
      en: {
        title: 'Sunset unengaged contacts',
        description: 'Ask long-silent contacts whether they still want to hear from you; tag those who do not answer within two weeks so they can be left out of future sends.',
        copy: { check_in: { subject: 'Should we keep in touch?', body: 'Hi {{name}}, it has been a while. Reply if you would still like to hear from us — otherwise we will stop emailing.' } },
      },
      nb: {
        title: 'Rydd inaktive kontakter',
        description: 'Spør kontakter som har vært stille lenge om de fortsatt vil høre fra dere; merk dem som ikke svarer innen to uker, så de kan holdes utenfor senere utsendelser.',
        copy: { check_in: { subject: 'Skal vi holde kontakten?', body: 'Hei {{name}}, det er en stund siden sist. Svar gjerne om du fortsatt vil høre fra oss — ellers slutter vi å sende e-post.' } },
      },
      sv: {
        title: 'Rensa inaktiva kontakter',
        description: 'Fråga kontakter som varit tysta länge om de fortfarande vill höra från er; tagga dem som inte svarar inom två veckor så att de kan hållas utanför framtida utskick.',
        copy: { check_in: { subject: 'Ska vi hålla kontakten?', body: 'Hej {{name}}, det var ett tag sedan. Svara gärna om du fortfarande vill höra från oss — annars slutar vi mejla.' } },
      },
    },
    spec: (copy, locale) => ({
      entry: { trigger: { type: 'segment', segmentId: '{{param:segmentId}}', schedule: 'weekly', at: '10:00', weekday: 'tue' }, reentry: 'once' },
      goal: { event: 'conversation.message.received', windowDays: 14 },
      settings: settings(locale, { frequencyCapPerWeek: 1 }),
      start: 'check_in',
      nodes: [
        email('check_in', copy, { next: 'wait14', onReply: 'done' }),
        { id: 'wait14', type: 'wait', duration: 'P14D', next: 'tag_sunset' },
        { id: 'tag_sunset', type: 'action', action: 'crm.add_tag', params: { tag: 'sunset' }, next: 'done' },
        { id: 'done', type: 'exit' },
      ],
    }),
  },
  {
    slug: 'booking-reminder',
    tags: ['hospitality', 'booking'],
    params: [{ ...SEGMENT, description: 'Segment of guests who may enter (crm_list_segments), for example everyone with a recorded lawful basis.' }],
    text: {
      en: {
        title: 'Booking reminder and thank-you',
        description: 'When a guest books through Munin: a reminder the day before, a thank-you after the visit, and the run ends if they cancel. The next booking within 90 days counts as the goal.',
        copy: {
          remind: { subject: 'See you tomorrow', body: 'Hi {{name}}, a reminder that we look forward to seeing you tomorrow. Reply if anything changes.' },
          thanks: { subject: 'Thanks for visiting', body: 'Hi {{name}}, thank you for coming. We would love to see you again — reply if there is anything we can do better.' },
        },
      },
      nb: {
        title: 'Bookingpåminnelse og takk',
        description: 'Når en gjest booker gjennom Munin: en påminnelse dagen før, en takk etter besøket, og løpet avsluttes hvis de kansellerer. Neste booking innen 90 dager teller som mål.',
        copy: {
          remind: { subject: 'Vi ses i morgen', body: 'Hei {{name}}, en påminnelse om at vi gleder oss til å se deg i morgen. Svar gjerne om noe endrer seg.' },
          thanks: { subject: 'Takk for besøket', body: 'Hei {{name}}, takk for at du kom. Vi ses gjerne igjen — svar om det er noe vi kan gjøre bedre.' },
        },
      },
      sv: {
        title: 'Bokningspåminnelse och tack',
        description: 'När en gäst bokar via Munin: en påminnelse dagen innan, ett tack efter besöket, och flödet avslutas om de avbokar. Nästa bokning inom 90 dagar räknas som mål.',
        copy: {
          remind: { subject: 'Vi ses i morgon', body: 'Hej {{name}}, en påminnelse om att vi ser fram emot att träffa dig i morgon. Svara gärna om något ändras.' },
          thanks: { subject: 'Tack för besöket', body: 'Hej {{name}}, tack för att du kom. Vi ses gärna igen — svara om det är något vi kan göra bättre.' },
        },
      },
    },
    spec: (copy, locale) => ({
      entry: { trigger: { type: 'event', event: 'booking.created' }, segmentId: '{{param:segmentId}}', reentry: 'once_at_a_time' },
      exit: { on: [{ event: 'booking.cancelled' }] },
      goal: { event: 'booking.created', windowDays: 90 },
      settings: settings(locale),
      start: 'before',
      nodes: [
        { id: 'before', type: 'wait', untilField: { field: 'context.trigger.properties.startsAt', offset: '-P1D' }, next: 'remind' },
        email('remind', copy, { class: 'transactional', next: 'after' }),
        { id: 'after', type: 'wait', untilField: { field: 'context.trigger.properties.startsAt', offset: 'PT3H' }, next: 'thanks' },
        email('thanks', copy, { next: 'done' }),
        { id: 'done', type: 'exit' },
      ],
    }),
  },
];

export const BUILT_IN_TEMPLATES: readonly JourneyTemplate[] = DEFS.flatMap((def) =>
  TEMPLATE_LOCALES.map((locale) => ({
    slug: def.slug,
    locale,
    title: def.text[locale].title,
    description: def.text[locale].description,
    tags: def.tags,
    params: def.params,
    spec: def.spec(def.text[locale].copy, locale),
    builtIn: true,
  })),
);

export function fillTemplate(value: unknown, params: Record<string, string>): unknown {
  if (typeof value === 'string') {
    return value.replace(/\{\{param:([a-zA-Z0-9_]+)\}\}/g, (match, key: string) => params[key] ?? match);
  }
  if (Array.isArray(value)) return value.map((v) => fillTemplate(v, params));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillTemplate(v, params)]));
  }
  return value;
}

export function missingParams(value: unknown): string[] {
  const found = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === 'string') for (const m of v.matchAll(/\{\{param:([a-zA-Z0-9_]+)\}\}/g)) found.add(m[1]!);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(value);
  return [...found];
}
