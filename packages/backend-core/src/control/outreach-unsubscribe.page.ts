import type { UnsubscribeState } from '../modules/outreach/outreach-unsubscribe.service.ts';

export type UnsubscribePageLocale = 'en' | 'nb';

export type UnsubscribePageView = UnsubscribeState | 'done';

interface Copy {
  title: string;
  heading: (org: string) => string;
  body: (org: string, orgAtStart: string) => string;
}

interface LocaleCopy {
  sender: string;
  button: string;
  views: Record<UnsubscribePageView, Copy>;
}

const COPY: Record<UnsubscribePageLocale, LocaleCopy> = {
  en: {
    sender: 'the sender',
    button: 'Unsubscribe',
    views: {
      subscribed: {
        title: 'Unsubscribe',
        heading: (org) => `Unsubscribe from ${org}?`,
        body: (org) =>
          `You will stop receiving emails like this from ${org}. If you write to them yourself, you will still get a reply.`,
      },
      done: {
        title: 'Unsubscribed',
        heading: () => 'You are unsubscribed',
        body: (_org, orgAtStart) => `${orgAtStart} will not send you emails like this again.`,
      },
      unsubscribed: {
        title: 'Unsubscribed',
        heading: () => 'You are already unsubscribed',
        body: (_org, orgAtStart) => `${orgAtStart} will not send you emails like this again.`,
      },
      not_found: {
        title: 'Unsubscribe',
        heading: () => 'Nothing to unsubscribe',
        body: (org) =>
          `This address is no longer on ${org}'s list, so there is nothing more to do.`,
      },
      invalid: {
        title: 'Link not working',
        heading: () => 'This link does not work',
        body: () =>
          'The unsubscribe link is incomplete or no longer valid. Reply to the email you received and ask to be removed, and the sender will take care of it.',
      },
    },
  },
  nb: {
    sender: 'avsenderen',
    button: 'Meld meg av',
    views: {
      subscribed: {
        title: 'Meld deg av',
        heading: (org) => `Vil du melde deg av e-poster fra ${org}?`,
        body: (org) =>
          `Du får ikke flere e-poster som denne fra ${org}. Skriver du selv til dem, får du fortsatt svar.`,
      },
      done: {
        title: 'Meldt av',
        heading: () => 'Du er meldt av',
        body: (_org, orgAtStart) => `${orgAtStart} sender deg ikke flere e-poster som denne.`,
      },
      unsubscribed: {
        title: 'Meldt av',
        heading: () => 'Du er allerede meldt av',
        body: (_org, orgAtStart) => `${orgAtStart} sender deg ikke flere e-poster som denne.`,
      },
      not_found: {
        title: 'Meld deg av',
        heading: () => 'Ingenting å melde av',
        body: (org) => `Denne adressen står ikke lenger på listen til ${org}, så du trenger ikke gjøre noe mer.`,
      },
      invalid: {
        title: 'Lenken virker ikke',
        heading: () => 'Lenken virker ikke',
        body: () =>
          'Avmeldingslenken er ufullstendig eller ikke lenger gyldig. Svar på e-posten du fikk og be om å bli fjernet, så ordner avsenderen det.',
      },
    },
  },
};

export function pickUnsubscribeLocale(acceptLanguage: string | undefined): UnsubscribePageLocale {
  if (!acceptLanguage) return 'en';
  const ranked = acceptLanguage
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().toLowerCase().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { tag, q: q ? Number(q.slice(2)) : 1, index };
    })
    .filter((entry) => entry.tag && Number.isFinite(entry.q) && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const { tag } of ranked) {
    const primary = tag.split('-')[0];
    if (primary === 'nb' || primary === 'no' || primary === 'nn') return 'nb';
    if (primary === 'en') return 'en';
  }
  return 'en';
}

export function renderUnsubscribePage(input: {
  view: UnsubscribePageView;
  locale: UnsubscribePageLocale;
  orgName: string | null;
  token: string | null;
}): string {
  const locale = COPY[input.locale];
  const copy = locale.views[input.view];
  const named = input.orgName?.trim();
  const org = named || locale.sender;
  const orgAtStart = named || capitalize(locale.sender);
  const form =
    input.view === 'subscribed' && input.token
      ? `<form method="post" action="?token=${escapeHtml(encodeURIComponent(input.token))}"><button type="submit">${escapeHtml(locale.button)}</button></form>`
      : '';
  return `<!doctype html>
<html lang="${input.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(copy.title)}</title>
<style>${STYLES}</style>
</head>
<body>
<main>
<h1>${escapeHtml(copy.heading(org))}</h1>
<p>${escapeHtml(copy.body(org, orgAtStart))}</p>
${form}
</main>
</body>
</html>`;
}

const STYLES = [
  'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f5f2;color:#1c1b19;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}',
  'main{max-width:28rem;margin:1.5rem;padding:2rem;background:#fff;border:1px solid #e4e1da;border-radius:12px}',
  'h1{margin:0 0 .75rem;font-size:1.25rem;line-height:1.3}',
  'p{margin:0;color:#4a4842}',
  'form{margin-top:1.5rem}',
  'button{font:inherit;font-weight:600;padding:.6rem 1.2rem;border:0;border-radius:8px;background:#1c1b19;color:#fff;cursor:pointer}',
  'button:focus-visible{outline:2px solid #1c1b19;outline-offset:2px}',
].join('');

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
