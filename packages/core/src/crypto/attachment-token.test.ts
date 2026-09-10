import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_TOKEN_MAX_AGE_SECONDS,
  AttachmentTokenError,
  signAttachmentToken,
  verifyAttachmentToken,
} from './attachment-token.ts';
import { signEmailOpenToken } from './email-open-token.ts';

const PEPPER = 'test-pepper-do-not-use-in-prod';

describe('attachment tokens', () => {
  it('round-trips a signed token', () => {
    const token = signAttachmentToken({ orgId: 'org_a', attachmentId: 'cva_b' }, PEPPER);
    const payload = verifyAttachmentToken(token, PEPPER);
    expect(payload.orgId).toBe('org_a');
    expect(payload.attachmentId).toBe('cva_b');
    expect(payload.issuedAt).toBeGreaterThan(0);
  });

  it('rejects a token signed with a different pepper', () => {
    const token = signAttachmentToken({ orgId: 'org_a', attachmentId: 'cva_b' }, PEPPER);
    expect(() => verifyAttachmentToken(token, 'other-pepper')).toThrow(AttachmentTokenError);
  });

  it('rejects a tampered attachmentId', () => {
    const token = signAttachmentToken({ orgId: 'org_a', attachmentId: 'cva_b' }, PEPPER);
    expect(() => verifyAttachmentToken(token.replace('cva_b', 'cva_evil'), PEPPER)).toThrow(
      AttachmentTokenError,
    );
  });

  it('rejects a tampered orgId so a token cannot be replayed across tenants', () => {
    const token = signAttachmentToken({ orgId: 'org_a', attachmentId: 'cva_b' }, PEPPER);
    expect(() => verifyAttachmentToken(token.replace('org_a', 'org_evil'), PEPPER)).toThrow(
      AttachmentTokenError,
    );
  });

  it('rejects a token older than the max age', () => {
    const issuedAt = Math.floor(Date.now() / 1000) - ATTACHMENT_TOKEN_MAX_AGE_SECONDS - 60;
    const token = signAttachmentToken({ orgId: 'org_a', attachmentId: 'cva_b', issuedAt }, PEPPER);
    expect(() => verifyAttachmentToken(token, PEPPER)).toThrow(/token expired/);
  });

  it('rejects a token issued in the future beyond the clock-skew allowance', () => {
    const issuedAt = Math.floor(Date.now() / 1000) + 30 * 60;
    const token = signAttachmentToken({ orgId: 'org_a', attachmentId: 'cva_b', issuedAt }, PEPPER);
    expect(() => verifyAttachmentToken(token, PEPPER)).toThrow(/issuedAt in the future/);
  });

  it('rejects a malformed token', () => {
    expect(() => verifyAttachmentToken('nope', PEPPER)).toThrow(/malformed token/);
  });

  it('does not accept a token minted for a different purpose', () => {
    const emailOpen = signEmailOpenToken({ orgId: 'org_a', deliveryId: 'cmd_b' }, PEPPER);
    expect(() => verifyAttachmentToken(emailOpen, PEPPER)).toThrow(AttachmentTokenError);
  });
});
