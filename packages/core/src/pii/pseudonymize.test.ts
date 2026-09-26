import { describe, expect, it } from 'vitest';
import { detectPii } from './detectors.ts';
import { buildPiiLexicon } from './lexicon.ts';
import {
  emptyPiiStats,
  pseudonymizeText,
  pseudonymizeValue,
  resolvePseudonyms,
} from './pseudonymize.ts';
import { formatContactEmail, formatContactName, formatContactPhone } from './tokens.ts';

const lexicon = buildPiiLexicon({
  orgId: 'org_test',
  secret: 'test-pepper',
  records: [
    { kind: 'crm_contact', id: 'cct_1', name: 'Kari Nordmann', email: 'kari@example.no', phone: '+4712345678' },
    { kind: 'conv_contact', id: 'ctc_2', name: 'Ola Nordmann', email: 'ola@example.no' },
  ],
  detectedNames: ['Per Olsen', 'Lise'],
});
const kari = lexicon.byEmail.get('kari@example.no')!;
const ola = lexicon.byEmail.get('ola@example.no')!;

describe('detectPii', () => {
  it('finds national IDs, including medium-confidence ones', () => {
    expect(detectPii('fnr 01819012365 ok').map((d) => d.kind)).toEqual(['national_id']);
  });

  it('finds Norwegian account numbers only when the check digit holds', () => {
    expect(detectPii('konto 1234.56.78903').map((d) => d.kind)).toEqual(['bank_account']);
    expect(detectPii('konto 1234.56.78904')).toEqual([]);
  });

  it('finds IBANs only when mod-97 holds', () => {
    expect(detectPii('IBAN GB82 WEST 1234 5698 7654 32.').map((d) => d.kind)).toEqual(['bank_account']);
    expect(detectPii('IBAN GB83 WEST 1234 5698 7654 32.')).toEqual([]);
  });

  it('finds card numbers only when Luhn holds', () => {
    expect(detectPii('card 4111 1111 1111 1111').map((d) => d.kind)).toEqual(['card_number']);
    expect(detectPii('card 4111 1111 1111 1112')).toEqual([]);
  });

  it('finds international and Norwegian mobile-shaped phone numbers', () => {
    expect(detectPii('ring +47 12 34 56 78').map((d) => d.kind)).toEqual(['phone']);
    expect(detectPii('ring 999 99 999').map((d) => d.kind)).toEqual(['phone']);
  });

  it('leaves order numbers, dates and ids alone', () => {
    expect(detectPii('order 10023456 placed 12.03.2026')).toEqual([]);
    expect(detectPii('cvm_0123456789abcdefghijkl')).toEqual([]);
  });

  it('finds emails in running text with the surrounding punctuation left out', () => {
    expect(detectPii('skriv til kari@example.no. eller (ola.n@example.com)').map((d) => d.value)).toEqual([
      'kari@example.no',
      'ola.n@example.com',
    ]);
    expect(detectPii('no tld a@b, nor @example.no, nor a@.example.no')).toEqual([]);
  });

  it('stays linear on input built to make a backtracking email pattern explode', () => {
    const hostile = `${'%'.repeat(100_000)}@${'a-'.repeat(50_000)}`;
    const started = Date.now();
    detectPii(hostile);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('treats any digit run matching a known phone as a phone', () => {
    const found = detectPii('call 12345678', { isKnownPhone: (raw) => raw === '12345678' });
    expect(found.map((d) => d.kind)).toEqual(['phone']);
  });
});

describe('pseudonymizeText', () => {
  it('tokenizes known contacts by full name, first name and email', () => {
    const out = pseudonymizeText('Hei Kari! Kari Nordmann skrev fra kari@example.no.', lexicon);
    expect(out).toBe(
      `Hei ${formatContactName(kari.token)}! ${formatContactName(kari.token)} skrev fra ${formatContactEmail(kari.token)}.`,
    );
  });

  it('masks an ambiguous surname generically instead of guessing', () => {
    expect(pseudonymizeText('Mvh Nordmann', lexicon)).toBe('Mvh [NAME]');
  });

  it('masks names the NER worker detected, but never mints a token for them', () => {
    expect(pseudonymizeText('Per Olsen og Lise kommer', lexicon)).toBe('[NAME] og [NAME] kommer');
  });

  it('does not treat lowercase words as names', () => {
    expect(pseudonymizeText('kari er et ord her, lise også', lexicon)).toBe('kari er et ord her, lise også');
  });

  it('masks a lowercase name when it is the whole value', () => {
    expect(pseudonymizeText('kari nordmann', lexicon)).toBe(formatContactName(kari.token));
  });

  it('catches names inside attachment filenames', () => {
    expect(pseudonymizeText('Kari-Nordmann-faktura.pdf', lexicon)).toBe(
      `${formatContactName(kari.token)}-faktura.pdf`,
    );
  });

  it('masks unknown emails and phones, tokenizes known ones', () => {
    expect(pseudonymizeText('fra anna@example.com, ring +47 12 34 56 78 eller 999 99 999', lexicon)).toBe(
      `fra [EMAIL], ring ${formatContactPhone(kari.token)} eller [PHONE]`,
    );
  });

  it('prefers the email over a name that overlaps it', () => {
    expect(pseudonymizeText('Kari.Nordmann@example.com', lexicon)).toBe('[EMAIL]');
  });

  it('is idempotent, leaving existing tokens untouched', () => {
    const once = pseudonymizeText('Kari Nordmann <kari@example.no> ringte', lexicon);
    expect(pseudonymizeText(once, lexicon)).toBe(once);
  });

  it('leaves opaque ids alone', () => {
    expect(pseudonymizeText('cct_0123456789abcdefghijkl', lexicon)).toBe('cct_0123456789abcdefghijkl');
  });

  it('counts what it replaced', () => {
    const stats = emptyPiiStats();
    pseudonymizeText('Kari, Per Olsen, fnr 01819012365', lexicon, stats);
    expect(stats.tokenized).toBe(1);
    expect(stats.masked.name).toBe(1);
    expect(stats.masked.national_id).toBe(1);
  });
});

describe('pseudonymizeValue', () => {
  it('walks nested results and masks person-name fields the lexicon does not know', () => {
    const out = pseudonymizeValue(
      {
        id: 'ccv_0123456789abcdefghijkl',
        contact: { name: 'Anna Berg', email: 'anna@example.com' },
        messages: [
          { authorName: 'Ola Nordmann', body: 'Hei, dette er Ola.' },
          { authorName: 'Support', body: 'Takk Ola!' },
        ],
        pipeline: { name: 'Sales' },
      },
      lexicon,
    );
    expect(out).toEqual({
      id: 'ccv_0123456789abcdefghijkl',
      contact: { name: '[NAME]', email: '[EMAIL]' },
      messages: [
        { authorName: formatContactName(ola.token), body: `Hei, dette er ${formatContactName(ola.token)}.` },
        { authorName: '[NAME]', body: `Takk ${formatContactName(ola.token)}!` },
      ],
      pipeline: { name: 'Sales' },
    });
  });

  it('masks phone fields whatever their format', () => {
    expect(pseudonymizeValue({ phone: '12345678' }, lexicon)).toEqual({
      phone: formatContactPhone(kari.token),
    });
    expect(pseudonymizeValue({ phone: '555 0100 22' }, lexicon)).toEqual({ phone: '[PHONE]' });
  });

  it('masks personal data used as an object key', () => {
    expect(pseudonymizeValue({ 'anna@example.com': 3 }, lexicon)).toEqual({ '[EMAIL]': 3 });
  });

  it('keeps numbers, booleans and null as they are', () => {
    expect(pseudonymizeValue({ n: 12345678, b: true, z: null }, lexicon)).toEqual({ n: 12345678, b: true, z: null });
  });
});

describe('resolvePseudonyms', () => {
  it('turns every rendered form back into the real value', () => {
    const { value, resolved, unresolved } = resolvePseudonyms(
      {
        email: formatContactEmail(kari.token),
        body: `Hei ${formatContactName(kari.token)}, vi ringer ${formatContactPhone(kari.token)}.`,
      },
      lexicon,
    );
    expect(value).toEqual({ email: 'kari@example.no', body: 'Hei Kari Nordmann, vi ringer +4712345678.' });
    expect(resolved).toBe(3);
    expect(unresolved).toBe(0);
  });

  it('leaves unknown tokens in place and counts them', () => {
    const { value, unresolved } = resolvePseudonyms('Contact aaaaaaaa', lexicon);
    expect(value).toBe('Contact aaaaaaaa');
    expect(unresolved).toBe(1);
  });

  it('round-trips a pseudonymized value back to the original', () => {
    const original = { email: 'kari@example.no', note: 'Kari Nordmann' };
    const masked = pseudonymizeValue(original, lexicon);
    expect(resolvePseudonyms(masked, lexicon).value).toEqual(original);
  });
});
