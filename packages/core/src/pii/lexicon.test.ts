import { describe, expect, it } from 'vitest';
import { buildPiiLexicon, emailKey, phoneKey, type PiiIdentityRecord } from './lexicon.ts';
import {
  findPseudonymReferences,
  formatContactEmail,
  formatContactName,
  formatContactPhone,
  pseudonymToken,
} from './tokens.ts';

const ORG = 'org_test';
const SECRET = 'test-pepper';

function lexicon(records: PiiIdentityRecord[], detectedNames: string[] = []) {
  return buildPiiLexicon({ orgId: ORG, secret: SECRET, records, detectedNames });
}

describe('pseudonymToken', () => {
  it('is stable for the same org, identity and secret', () => {
    expect(pseudonymToken(ORG, 'email:kari@example.no', SECRET)).toBe(
      pseudonymToken(ORG, 'email:kari@example.no', SECRET),
    );
  });

  it('differs across orgs, so tokens cannot be joined between tenants', () => {
    expect(pseudonymToken('org_a', 'email:kari@example.no', SECRET)).not.toBe(
      pseudonymToken('org_b', 'email:kari@example.no', SECRET),
    );
  });

  it('differs across secrets, so a token cannot be recomputed from a guessed email', () => {
    expect(pseudonymToken(ORG, 'email:kari@example.no', 'a')).not.toBe(
      pseudonymToken(ORG, 'email:kari@example.no', 'b'),
    );
  });

  it('uses eight lowercase base32 characters', () => {
    expect(pseudonymToken(ORG, 'x', SECRET)).toMatch(/^[a-z2-7]{8}$/);
  });
});

describe('findPseudonymReferences', () => {
  it('finds every rendered form, bracketed or not', () => {
    const text = `${formatContactName('abcdefgh')} wrote from ${formatContactEmail('abcdefgh')}, call ${formatContactPhone('abcdefgh')} or Contact bcdefghi`;
    expect(findPseudonymReferences(text).map((r) => [r.kind, r.token])).toEqual([
      ['name', 'abcdefgh'],
      ['email', 'abcdefgh'],
      ['phone', 'abcdefgh'],
      ['name', 'bcdefghi'],
    ]);
  });

  it('ignores a token of the wrong length', () => {
    expect(findPseudonymReferences('Contact abc')).toEqual([]);
  });
});

describe('emailKey and phoneKey', () => {
  it('lowercases emails and rejects pseudonym addresses', () => {
    expect(emailKey(' Kari@Example.NO ')).toBe('kari@example.no');
    expect(emailKey(formatContactEmail('abcdefgh'))).toBeNull();
    expect(emailKey('not an email')).toBeNull();
  });

  it('keys phones by their last eight digits so formatting does not split an identity', () => {
    expect(phoneKey('+47 12 34 56 78')).toBe('12345678');
    expect(phoneKey('004712345678')).toBe('12345678');
    expect(phoneKey('12345678')).toBe('12345678');
    expect(phoneKey('1234')).toBeNull();
  });
});

describe('buildPiiLexicon', () => {
  it('merges records that share an email into one identity with one token', () => {
    const lex = lexicon([
      { kind: 'crm_contact', id: 'cct_1', name: 'Kari Nordmann', email: 'kari@example.no' },
      { kind: 'conv_contact', id: 'ctc_1', name: 'Kari N.', email: 'KARI@example.no' },
      { kind: 'end_user', id: 'eu_1', email: 'kari@example.no', phone: '+4712345678' },
    ]);
    expect(lex.identities).toHaveLength(1);
    const identity = lex.identities[0]!;
    expect(identity.name).toBe('Kari Nordmann');
    expect(identity.refs.map((r) => r.kind)).toEqual(['crm_contact', 'conv_contact', 'end_user']);
    expect(lex.byEmail.get('kari@example.no')).toBe(identity);
    expect(lex.byPhone.get('12345678')).toBe(identity);
    expect(lex.byToken.get(identity.token)).toBe(identity);
  });

  it('merges transitively through a shared phone', () => {
    const lex = lexicon([
      { kind: 'crm_contact', id: 'cct_1', name: 'Ola Nordmann', email: 'ola@example.no' },
      { kind: 'end_user', id: 'eu_1', email: 'ola@example.no', phone: '+4712345678' },
      { kind: 'conv_contact', id: 'ctc_1', phone: '12 34 56 78' },
    ]);
    expect(lex.identities).toHaveLength(1);
  });

  it('keys the token on the email, so it survives the record being recreated', () => {
    const before = lexicon([{ kind: 'crm_contact', id: 'cct_1', name: 'Kari Nordmann', email: 'kari@example.no' }]);
    const after = lexicon([{ kind: 'crm_contact', id: 'cct_2', name: 'Kari Nordmann', email: 'kari@example.no' }]);
    expect(after.identities[0]!.token).toBe(before.identities[0]!.token);
  });

  it('indexes the full name, its sub-phrases, and the first and last names', () => {
    const lex = lexicon([{ kind: 'crm_contact', id: 'cct_1', name: 'Kari Anne Nordmann' }]);
    const identity = lex.identities[0]!;
    for (const phrase of ['kari anne nordmann', 'kari anne', 'anne nordmann', 'kari', 'nordmann']) {
      expect(lex.names.get(phrase), phrase).toBe(identity);
    }
    expect(lex.names.has('anne')).toBe(false);
    expect(lex.maxNameWords).toBe(3);
  });

  it('marks a name shared by two identities as ambiguous rather than picking one', () => {
    const lex = lexicon([
      { kind: 'crm_contact', id: 'cct_1', name: 'Kari Nordmann', email: 'kari@example.no' },
      { kind: 'crm_contact', id: 'cct_2', name: 'Kari Hansen', email: 'hansen@example.no' },
    ]);
    expect(lex.names.get('kari')).toBeNull();
    expect(lex.names.get('kari nordmann')).toBe(lex.byEmail.get('kari@example.no'));
  });

  it('skips names that are really addresses or role accounts', () => {
    const lex = lexicon([
      { kind: 'conv_contact', id: 'ctc_1', name: 'post@example.no', email: 'post@example.no' },
      { kind: 'conv_contact', id: 'ctc_2', name: 'Kundeservice', email: 'ks@example.no' },
    ]);
    expect(lex.names.size).toBe(0);
    expect(lex.identities.every((i) => i.name === null)).toBe(true);
  });

  it('keeps capitalised detected names and drops the lowercase fragments NER over-fires on', () => {
    const lex = lexicon([], ['Per Olsen', 'ola', 'X', 'Hei', 'Anne-Lise']);
    expect([...lex.detectedNames].sort()).toEqual(['anne lise', 'per olsen']);
  });
});

describe('emailKey on hostile input', () => {
  it('rejects malformed addresses without backtracking on long runs', () => {
    const hostile = `${'!.'.repeat(50_000)}@`;
    const started = Date.now();
    expect(emailKey(hostile)).toBeNull();
    expect(emailKey('a@b@example.no')).toBeNull();
    expect(emailKey('kari@example.')).toBeNull();
    expect(emailKey('@example.no')).toBeNull();
    expect(Date.now() - started).toBeLessThan(200);
  });
});
