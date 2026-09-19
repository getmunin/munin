const RESERVED_DOMAIN =
  /(^|\.)(test|example|invalid|localhost|local)$|(^|\.)example\.(com|net|org|no)$|(^|\.)acme\.(com|test|example)$/i;

export const ALLOWED_DOMAINS = {
  'getmunin.com': 'our own domain',
  'in.getmunin.com': 'our own inbound mail domain',
  'sendgrid.net': 'vendor bounce address, part of bounce-detection fixtures',
  'amazonses.com': 'vendor bounce address, part of bounce-detection fixtures',
  'anthropic.com': 'published crawler contact, part of bot-UA detection',
  'bytedance.com': 'published crawler contact, part of bot-UA detection',
  'gastroplanner.no': 'connector vendor support address, published by the vendor',
  'a.org': 'single-letter placeholder',
  'b.no': 'single-letter placeholder',
  'x.com': 'single-letter placeholder',
  'x.no': 'single-letter placeholder',
  'y.no': 'single-letter placeholder',
  'x.dev': 'single-letter placeholder',
  'kunde.no': 'Norwegian for "customer", a placeholder',
  'eksempel.no': 'Norwegian for "example", a placeholder',
  'company.com': 'generic placeholder',
  'customer.com': 'generic placeholder',
  'partner.com': 'generic placeholder',
  'otherco.com': 'generic placeholder',
  'other.com': 'generic placeholder',
  'elsewhere.com': 'generic placeholder',
  'notacme.com': 'generic placeholder',
  'fjordware.com': 'invented company used across CRM merge fixtures',
  'azienda.it': 'i18n locale sample for "company"',
  'bedrijf.nl': 'i18n locale sample for "company"',
  'ceg.hu': 'i18n locale sample for "company"',
  'companie.ro': 'i18n locale sample for "company"',
  'empresa.es': 'i18n locale sample for "company"',
  'empresa.pt': 'i18n locale sample for "company"',
  'entreprise.fr': 'i18n locale sample for "company"',
  'ettevote.ee': 'i18n locale sample for "company"',
  'firma.cz': 'i18n locale sample for "company"',
  'firma.de': 'i18n locale sample for "company"',
  'firma.dk': 'i18n locale sample for "company"',
  'firma.no': 'i18n locale sample for "company"',
  'firma.pl': 'i18n locale sample for "company"',
  'firma.sk': 'i18n locale sample for "company"',
  'foretag.se': 'i18n locale sample for "company"',
  'fyrirtaeki.is': 'i18n locale sample for "company"',
  'imone.lt': 'i18n locale sample for "company"',
  'uznemums.lv': 'i18n locale sample for "company"',
  'yritys.fi': 'i18n locale sample for "company"',
};

export const ALLOWED_HOSTS = {
  '.getmunin.com': 'our own domain and its subdomains',
  'threll.ai': 'our own sibling product',
  'claude.ai': 'vendor host referenced in MCP fixtures',
  'claude.com': 'vendor host in the Claude Code attribution footer on commits and PRs',
  'api.anthropic.com': 'LLM vendor endpoint',
  'api.openai.com': 'LLM vendor endpoint',
  'openai.com': 'LLM vendor endpoint',
  'openrouter.ai': 'LLM vendor endpoint',
  'api.scaleway.ai': 'LLM vendor endpoint',
  'perplexity.ai': 'LLM vendor endpoint',
  's3.fr-par.scw.cloud': 'object storage vendor endpoint',
  'cdn.shopify.com': 'commerce connector vendor endpoint',
  'api.gastroplanner.eu': 'bookings connector vendor endpoint',
  'api.vapi.ai': 'voice vendor endpoint',
  'api.slack.com': 'operator bridge vendor endpoint',
  'www.linkedin.com': 'social distribution vendor OAuth endpoint',
  'api.linkedin.com': 'social distribution vendor API endpoint',
  'www.facebook.com': 'social distribution vendor OAuth dialog and post permalink host',
  'graph.facebook.com': 'social distribution vendor API endpoint',
  'business.facebook.com': 'social distribution vendor composer, linked when Munin cannot publish',
  'developers.facebook.com': 'social distribution vendor app portal, linked from the connect card',
  'learn.microsoft.com': 'published LinkedIn API documentation, part of version pinning',
  'developer.amazon.com': 'published crawler documentation, part of bot-UA detection',
  'ahrefs.com': 'published crawler documentation, part of bot-UA detection',
  'accounts.google.com': 'OAuth vendor endpoint',
  'oauth2.googleapis.com': 'OAuth vendor endpoint',
  'www.googleapis.com': 'vendor API endpoint',
  'searchconsole.googleapis.com': 'seo connector vendor endpoint',
  'google.com': 'vendor host used in scraper and seo fixtures',
  'www.google.com': 'vendor host used in scraper and seo fixtures',
  'www.bing.com': 'seo connector vendor endpoint',
  'ssl.bing.com': 'seo connector vendor endpoint',
  'github.com': 'our own source host',
  'esm.sh': 'CDN referenced in MCP Apps fixtures',
  'unpkg.com': 'CDN referenced in MCP Apps fixtures',
  'www.w3.org': 'XML namespace URI, not a fetched host',
  'european-union.europa.eu': 'public reference page used in a scraper fixture',
  'news.ycombinator.com': 'public site used in a scraper fixture',
  'www.reddit.com': 'public site used in a scraper fixture',
  'youtube.com': 'public site used in an embed fixture',
  'json-schema.org': 'JSON Schema spec URI, not a fetched host',
  'api.vercel.com': 'deployment vendor endpoint named in a skill',
  'api.example-tenant.com': 'placeholder tenant host in a skill example',
  '.lovable.app': 'deployment vendor preview host named in a skill',
};

export const ALLOWED_REAL_SHAPED_PHONES = {
  '+15005550006': 'Twilio magic test number, must stay exact for the vendor to recognise it',
  '+4740000000': 'CRM merge-evidence fixture, needs a parseable number',
  '+4755500001': 'identity-service fixture, needs a parseable number',
  '+4788888888': 'Slack projection fixture, needs a parseable number',
  '+4790000000': 'bookings and CRM skill examples, need a parseable number',
  '+4791234567': 'nb.json locale sample, rendered in the dashboard',
  '+4798654321': 'CRM merge fixtures, need a parseable number',
  '+4799887766': 'CRM lead-import skill example',
  '+4799999999': 'inbox phone-formatting tests, assert libphonenumber grouping',
};

const COUNTRY_CODES = [
  '1', '7', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44', '45', '46',
  '47', '48', '49', '55', '61', '64', '81', '86', '90', '91', '351', '352', '353', '354', '356',
  '358', '359', '370', '371', '372', '385', '386', '420', '421', '971', '972',
];

const UK_DRAMA = [
  /^77009\d{5}$/,
  /^1632960\d{3}$/,
  /^2079460\d{3}$/,
  /^(?:113|114|115|116|117|118|121|131|141|151|161)4960\d{3}$/,
  /^2890180\d{3}$/,
  /^2920180\d{3}$/,
];

const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const URL_HOST = /\bhttps?:\/\/([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const PHONE = /\+\d{1,3}(?:[ -]?\d){6,14}/g;

const FIXTURE_PATH =
  /\.(test|spec)\.(ts|tsx|mts|js|mjs)$|\.integration\.test\.ts$|^\.changeset\/|docs-fixtures\//;

function trimPunctuation(value) {
  return value.replace(/[.,;:)\]}>'"]+$/, '');
}

function splitCountryCode(digits) {
  for (const length of [3, 2, 1]) {
    const code = digits.slice(0, length);
    if (COUNTRY_CODES.includes(code)) return { code, national: digits.slice(length) };
  }
  return null;
}

export function isUnassignablePhone(e164) {
  const digits = e164.replace(/\D/g, '');
  const split = splitCountryCode(digits);
  if (!split) return false;
  const { code, national } = split;
  if (code === '1') {
    if (national.length === 7) return national.startsWith('555');
    if (national.length !== 10) return false;
    return national.startsWith('555') || (national.slice(3, 6) === '555' && national.slice(6, 8) === '01');
  }
  if (code === '44') return UK_DRAMA.some((re) => re.test(national));
  if (code === '39') return false;
  if (code === '47') {
    if (national.length !== 8) return true;
    return national.startsWith('0') || national.startsWith('1');
  }
  return national.startsWith('0');
}

export function isAllowedHost(host) {
  const clean = trimPunctuation(host.toLowerCase());
  if (RESERVED_DOMAIN.test(clean)) return true;
  if (clean in ALLOWED_DOMAINS) return true;
  if (clean in ALLOWED_HOSTS) return true;
  return Object.keys(ALLOWED_HOSTS).some((key) => key.startsWith('.') && clean.endsWith(key));
}

export function scanText(text, { file = null, hostnames = null } = {}) {
  const checkHostnames = hostnames === null ? (file ? FIXTURE_PATH.test(file) : true) : hostnames;
  const problems = [];
  const lines = text.split('\n');

  lines.forEach((line, i) => {
    for (const m of line.matchAll(EMAIL)) {
      const domain = trimPunctuation(m[1].toLowerCase());
      if (RESERVED_DOMAIN.test(domain) || domain in ALLOWED_DOMAINS) continue;
      problems.push({ file, line: i + 1, kind: 'email', value: m[0] });
    }
    for (const m of line.matchAll(PHONE)) {
      const normalised = `+${m[0].replace(/\D/g, '')}`;
      if (normalised.length < 9) continue;
      if (isUnassignablePhone(normalised)) continue;
      if (normalised in ALLOWED_REAL_SHAPED_PHONES) continue;
      problems.push({ file, line: i + 1, kind: 'phone', value: m[0] });
    }
    if (!checkHostnames) return;
    for (const m of line.matchAll(URL_HOST)) {
      if (isAllowedHost(m[1])) continue;
      problems.push({ file, line: i + 1, kind: 'host', value: trimPunctuation(m[1]) });
    }
  });

  return problems;
}

const GUIDANCE = {
  email:
    'Use a reserved domain instead — anything under .test / .example / .invalid, or\n' +
    'example.com / example.no. Those can never be registered, so a fixture built on\n' +
    'one can never name a real mailbox. A genuinely real address (a vendor bounce\n' +
    'address, a published crawler contact) goes in ALLOWED_DOMAINS in\n' +
    'scripts/lib/pii.mjs with a short reason.',
  phone:
    'Most numbering plans strip the trunk prefix, so a national number starting 0 can\n' +
    'never be assigned — +4712345678 is safe, +4791234567 may be someone real. In\n' +
    'NANP use the reserved fiction block 555-0100 to 555-0199 (+14155550123). A test\n' +
    'that needs a real-shaped number to parse or format goes in\n' +
    'ALLOWED_REAL_SHAPED_PHONES in scripts/lib/pii.mjs with the reason.',
  host:
    'A customer\'s own domain in a fixture or a changeset names them just as surely as\n' +
    'their email does. Use a reserved domain (nordicsupply.test), or add a genuine\n' +
    'vendor or public host to ALLOWED_HOSTS in scripts/lib/pii.mjs with a reason.',
};

const HEADINGS = {
  email: 'Email addresses on a domain that is neither reserved nor allow-listed:',
  phone: 'Phone numbers that could belong to a real person:',
  host: 'Hostnames that are neither reserved nor allow-listed:',
};

export function renderProblems(problems, { surface = 'Fixture data' } = {}) {
  const byKind = { email: [], phone: [], host: [] };
  for (const p of problems) byKind[p.kind].push(p);

  let out = `\n${surface} that is not obviously fake:\n\n`;
  for (const kind of ['email', 'phone', 'host']) {
    if (!byKind[kind].length) continue;
    out += `  ${HEADINGS[kind]}\n`;
    for (const p of byKind[kind]) {
      out += `    ${p.file ? `${p.file}:${p.line}` : `line ${p.line}`}  ${p.value}\n`;
    }
    out += `\n${GUIDANCE[kind].replace(/^/gm, '  ')}\n\n`;
  }
  out +=
    'Why this check exists: fixtures, changesets, commit messages and pull request\n' +
    'bodies are published surfaces. They reach tarballs, release notes and pull\n' +
    'request descriptions, and not all of those can be retracted later. Data pulled\n' +
    'from a real tenant to debug with is context to read, never content to paste.\n';
  return out;
}

export const ALLOW_LIST_FILES = new Set(['scripts/lib/pii.mjs']);
