import { describe, expect, it } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { signHmac, widgetIdentityHashPayload } from '@getmunin/core';
import { verifyIdentity } from './widget-ingest.service.ts';

const secret = 'widget-identity-secret';
const config = { identityVerificationSecret: secret, requireVerifiedIdentity: false };

describe('verifyIdentity', () => {
  it('keeps accepting a hash over the external id alone, with no email', () => {
    expect(
      verifyIdentity(config, { verifiedExternalId: 'u1', userHash: signHmac('u1', secret) }),
    ).toEqual({ mode: 'verified', externalId: 'u1' });
  });

  it('returns the signed email, normalized, when the hash covers it', () => {
    const userHash = signHmac(
      widgetIdentityHashPayload({ externalId: 'u1', email: 'ola@example.test' }),
      secret,
    );
    expect(
      verifyIdentity(config, {
        verifiedExternalId: 'u1',
        verifiedEmail: ' Ola@Example.test ',
        userHash,
      }),
    ).toEqual({ mode: 'verified', externalId: 'u1', email: 'ola@example.test' });
  });

  it('rejects an email riding on a hash that signed only the external id', () => {
    expect(() =>
      verifyIdentity(config, {
        verifiedExternalId: 'u1',
        verifiedEmail: 'ola@example.test',
        userHash: signHmac('u1', secret),
      }),
    ).toThrow(ForbiddenException);
  });

  it('rejects a hash signed for a different email', () => {
    const userHash = signHmac(
      widgetIdentityHashPayload({ externalId: 'u1', email: 'kari@example.test' }),
      secret,
    );
    expect(() =>
      verifyIdentity(config, { verifiedExternalId: 'u1', verifiedEmail: 'ola@example.test', userHash }),
    ).toThrow(ForbiddenException);
  });

  it('rejects a hash over the email payload presented without the email', () => {
    const userHash = signHmac(
      widgetIdentityHashPayload({ externalId: 'u1', email: 'ola@example.test' }),
      secret,
    );
    expect(() => verifyIdentity(config, { verifiedExternalId: 'u1', userHash })).toThrow(
      ForbiddenException,
    );
  });

  it('rejects an email without an external id and hash as a partial identity', () => {
    expect(() => verifyIdentity(config, { verifiedEmail: 'ola@example.test' })).toThrow(
      'identity_partial',
    );
  });
});
