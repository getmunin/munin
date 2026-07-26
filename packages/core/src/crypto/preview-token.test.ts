import { describe, it, expect } from 'vitest';
import { signPreviewToken, verifyPreviewToken, PreviewTokenError } from './preview-token.ts';
import { signEmailOpenToken } from './email-open-token.ts';
import { signViewToken } from './view-token.ts';

const PEPPER = 'test-pepper-do-not-use-in-prod';

describe('preview tokens', () => {
  it('round-trips a signed token', () => {
    const token = signPreviewToken({ orgId: 'org_a', entryId: 'cme_b' }, PEPPER);
    const payload = verifyPreviewToken(token, PEPPER);
    expect(payload.orgId).toBe('org_a');
    expect(payload.entryId).toBe('cme_b');
    expect(payload.issuedAt).toBeGreaterThan(0);
  });

  it('rejects a token signed with a different pepper', () => {
    const token = signPreviewToken({ orgId: 'org_a', entryId: 'cme_b' }, PEPPER);
    expect(() => verifyPreviewToken(token, 'other-pepper')).toThrow(PreviewTokenError);
  });

  it('rejects a tampered entryId', () => {
    const token = signPreviewToken({ orgId: 'org_a', entryId: 'cme_b' }, PEPPER);
    const tampered = token.replace('cme_b', 'cme_evil');
    expect(() => verifyPreviewToken(tampered, PEPPER)).toThrow(PreviewTokenError);
  });

  it('rejects a tampered orgId', () => {
    const token = signPreviewToken({ orgId: 'org_a', entryId: 'cme_b' }, PEPPER);
    const tampered = token.replace('org_a', 'org_evil');
    expect(() => verifyPreviewToken(tampered, PEPPER)).toThrow(PreviewTokenError);
  });

  it('rejects malformed tokens', () => {
    expect(() => verifyPreviewToken('garbage', PEPPER)).toThrow(PreviewTokenError);
    expect(() => verifyPreviewToken('a.b.c.d', PEPPER)).toThrow(PreviewTokenError);
  });

  it('rejects field values containing dots or whitespace', () => {
    expect(() => signPreviewToken({ orgId: 'org.a', entryId: 'cme_b' }, PEPPER)).toThrow();
    expect(() => signPreviewToken({ orgId: 'org_a', entryId: 'cme b' }, PEPPER)).toThrow();
  });

  it('rejects a token older than the max age', () => {
    const token = signPreviewToken(
      { orgId: 'org_a', entryId: 'cme_b', issuedAt: 1700000000 },
      PEPPER,
    );
    expect(() => verifyPreviewToken(token, PEPPER)).toThrow(/expired/);
  });

  it('rejects a token issued in the future', () => {
    const future = Math.floor(Date.now() / 1000) + 60 * 60;
    const token = signPreviewToken(
      { orgId: 'org_a', entryId: 'cme_b', issuedAt: future },
      PEPPER,
    );
    expect(() => verifyPreviewToken(token, PEPPER)).toThrow(/future/);
  });

  it('rejects tokens from other token families signed with the same pepper', () => {
    const emailOpen = signEmailOpenToken({ orgId: 'org_a', deliveryId: 'cme_b' }, PEPPER);
    expect(() => verifyPreviewToken(emailOpen, PEPPER)).toThrow(PreviewTokenError);
    const view = signViewToken(
      { orgId: 'org_a', subjectType: 'cms', subjectId: 'cme_b' },
      PEPPER,
    );
    expect(() => verifyPreviewToken(view, PEPPER)).toThrow(PreviewTokenError);
  });
});
