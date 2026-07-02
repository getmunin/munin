import { describe, it, expect } from 'vitest';
import { signViewToken, verifyViewToken, ViewTokenError } from './view-token.ts';

const PEPPER = 'test-pepper-do-not-use-in-prod';

describe('view tokens', () => {
  it('round-trips a signed token', () => {
    const token = signViewToken(
      { orgId: 'org_a', subjectType: 'cms_entry', subjectId: 'cme_b' },
      PEPPER,
    );
    const payload = verifyViewToken(token, PEPPER);
    expect(payload.orgId).toBe('org_a');
    expect(payload.subjectType).toBe('cms_entry');
    expect(payload.subjectId).toBe('cme_b');
    expect(payload.issuedAt).toBeGreaterThan(0);
  });

  it('rejects a token signed with a different pepper', () => {
    const token = signViewToken(
      { orgId: 'org_a', subjectType: 'cms_entry', subjectId: 'cme_b' },
      PEPPER,
    );
    expect(() => verifyViewToken(token, 'other-pepper')).toThrow(ViewTokenError);
  });

  it('rejects a tampered subject', () => {
    const token = signViewToken(
      { orgId: 'org_a', subjectType: 'cms_entry', subjectId: 'cme_b' },
      PEPPER,
    );
    const tampered = token.replace('cme_b', 'cme_evil');
    expect(() => verifyViewToken(tampered, PEPPER)).toThrow(ViewTokenError);
  });

  it('rejects a tampered subjectType', () => {
    const token = signViewToken(
      { orgId: 'org_a', subjectType: 'cms_entry', subjectId: 'cme_b' },
      PEPPER,
    );
    const tampered = token.replace('cms_entry', 'landing');
    expect(() => verifyViewToken(tampered, PEPPER)).toThrow(ViewTokenError);
  });

  it('rejects malformed tokens', () => {
    expect(() => verifyViewToken('garbage', PEPPER)).toThrow(ViewTokenError);
    expect(() => verifyViewToken('a.b.c.d', PEPPER)).toThrow(ViewTokenError);
  });

  it('rejects field values containing dots or whitespace', () => {
    expect(() =>
      signViewToken({ orgId: 'org.a', subjectType: 'x', subjectId: 'y' }, PEPPER),
    ).toThrow();
    expect(() =>
      signViewToken({ orgId: 'org_a', subjectType: 'x y', subjectId: 'y' }, PEPPER),
    ).toThrow();
  });

  it('preserves a caller-supplied issuedAt', () => {
    const token = signViewToken(
      { orgId: 'org_a', subjectType: 'cms_entry', subjectId: 'cme_b', issuedAt: 1700000000 },
      PEPPER,
    );
    const payload = verifyViewToken(token, PEPPER, Infinity);
    expect(payload.issuedAt).toBe(1700000000);
  });

  it('rejects a token older than the max age', () => {
    const token = signViewToken(
      { orgId: 'org_a', subjectType: 'cms_entry', subjectId: 'cme_b', issuedAt: 1700000000 },
      PEPPER,
    );
    expect(() => verifyViewToken(token, PEPPER)).toThrow(/expired/);
  });
});
