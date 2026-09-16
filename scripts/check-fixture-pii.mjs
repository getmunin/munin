#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const RESERVED_DOMAIN =
  /(^|\.)(test|example|invalid|localhost)$|(^|\.)example\.(com|net|org|no)$|(^|\.)acme\.(com|test|example)$/i;

const ALLOWED_DOMAINS = {
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

const ALLOWED_REAL_SHAPED_PHONES = {
  '+4740000000': 'CRM merge-evidence fixture, needs a parseable number',
  '+4755500001': 'identity-service fixture, needs a parseable number',
  '+4788888888': 'Slack projection fixture, needs a parseable number',
  '+4790000000': 'bookings and CRM skill examples, need a parseable number',
  '+4791234567': 'nb.json locale sample, rendered in the dashboard',
  '+4798654321': 'CRM merge fixtures, need a parseable number',
  '+4799887766': 'CRM lead-import skill example',
  '+4799999999': 'inbox phone-formatting tests, assert libphonenumber grouping',
};

const SKIP_PATH =
  /(^|\/)(node_modules|dist|\.next|coverage|\.turbo)\/|^pnpm-lock\.yaml$|^THIRD_PARTY_LICENSES\.md$|^scripts\/check-fixture-pii\.mjs$/;

const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const NO_PHONE = /\+47[\s]?(?:[0-9][\s]?){8}/g;

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], { maxBuffer: 1 << 28 })
    .toString()
    .split('\0')
    .filter((f) => f && !SKIP_PATH.test(f));
}

const problems = [];

for (const file of trackedFiles()) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (text.includes('\0')) continue;

  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(EMAIL)) {
      const domain = m[1].toLowerCase().replace(/[.,;:)\]}>'"]+$/, '');
      if (RESERVED_DOMAIN.test(domain)) continue;
      if (domain in ALLOWED_DOMAINS) continue;
      problems.push({ file, line: i + 1, kind: 'email', value: m[0], domain });
    }
    for (const m of line.matchAll(NO_PHONE)) {
      const normalised = m[0].replace(/\s/g, '');
      const national = normalised.slice(3);
      if (national.startsWith('0') || national.startsWith('1')) continue;
      if (normalised in ALLOWED_REAL_SHAPED_PHONES) continue;
      problems.push({ file, line: i + 1, kind: 'phone', value: m[0], domain: normalised });
    }
  });
}

if (problems.length === 0) {
  process.exit(0);
}

const byKind = { email: [], phone: [] };
for (const p of problems) byKind[p.kind].push(p);

console.error('\nFixture data that is not obviously fake:\n');

if (byKind.email.length) {
  console.error('  Email addresses on a domain that is neither reserved nor allow-listed:');
  for (const p of byKind.email) console.error(`    ${p.file}:${p.line}  ${p.value}`);
  console.error(
    '\n  Use a reserved domain instead — anything under .test / .example / .invalid,\n' +
      '  or example.com / example.no. Those can never be registered, so a fixture\n' +
      '  built on one can never name a real mailbox.\n' +
      '\n  If the address is genuinely meant to be real (a vendor bounce address, a\n' +
      '  published crawler contact), add the domain to ALLOWED_DOMAINS in\n' +
      '  scripts/check-fixture-pii.mjs with a short reason. That edit is the review\n' +
      '  checkpoint: it should be a deliberate decision, not a paste.\n',
  );
}

if (byKind.phone.length) {
  console.error('  Norwegian phone numbers that could belong to a real person:');
  for (const p of byKind.phone) console.error(`    ${p.file}:${p.line}  ${p.value}`);
  console.error(
    '\n  Norway assigns subscriber numbers starting 2-9, so a number you invented\n' +
      '  may still be assigned to someone. Use a national number starting 0 or 1\n' +
      '  instead, e.g. +4712345678 — Norway never assigns those, so the number\n' +
      '  cannot belong to anyone.\n' +
      '\n  The exception is a test that asserts formatting: libphonenumber only\n' +
      '  groups digits for numbers it considers valid, so +4712345678 renders as\n' +
      '  "+47 12345678" rather than grouped. Such a fixture needs a real-shaped\n' +
      '  number — add it to ALLOWED_REAL_SHAPED_PHONES with the reason, so the\n' +
      '  trade-off is visible in review rather than assumed.\n',
  );
}

console.error(
  'Why this check exists: fixture data is a published surface. Test files and\n' +
    'changelog prose reach tarballs, release notes and pull request descriptions,\n' +
    'and not all of those can be retracted later. Keeping fixtures on reserved\n' +
    'domains and unassignable numbers means nothing in them can name a real\n' +
    'person in the first place.\n',
);

process.exit(1);
