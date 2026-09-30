import { describe, it, expect } from 'vitest';
import { ApiError } from '../api';
import {
  extractInviteToken,
  inviteAuthHref,
  isInvalidInvitationError,
} from './invitation-lookup';

function apiError(status: number): ApiError {
  return new ApiError({
    status,
    statusText: '',
    endpoint: '/v1/invitations/lookup',
    method: 'GET',
    requestId: null,
    message: `status ${status}`,
  });
}

describe('extractInviteToken', () => {
  it('reads the token from an accept-invite redirect', () => {
    expect(extractInviteToken('/accept-invite?token=abc123')).toBe('abc123');
  });

  it('ignores redirects to other pages', () => {
    expect(extractInviteToken('/dashboard?token=abc123')).toBeNull();
  });

  it('returns null without a redirect or token', () => {
    expect(extractInviteToken(null)).toBeNull();
    expect(extractInviteToken('/accept-invite')).toBeNull();
  });
});

describe('inviteAuthHref', () => {
  it('round-trips the token through the redirect parameter', () => {
    const href = inviteAuthHref('/signup', 'a+b/c');
    const redirect = new URL(href, 'http://placeholder').searchParams.get('redirect');
    expect(href.startsWith('/signup?redirect=')).toBe(true);
    expect(extractInviteToken(redirect)).toBe('a+b/c');
  });
});

describe('isInvalidInvitationError', () => {
  it('treats not-found and bad-request as an invalid invitation', () => {
    expect(isInvalidInvitationError(apiError(404))).toBe(true);
    expect(isInvalidInvitationError(apiError(400))).toBe(true);
  });

  it('treats rate limiting and network failures as a failed lookup', () => {
    expect(isInvalidInvitationError(apiError(429))).toBe(false);
    expect(isInvalidInvitationError(new TypeError('fetch failed'))).toBe(false);
  });
});
