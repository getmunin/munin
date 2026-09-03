import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import {
  isOriginAllowedForCookieAuth,
  readBearerSubprotocol,
  widgetGateReason,
} from './realtime.gateway.ts';

describe('readBearerSubprotocol', () => {
  it('returns null for undefined', () => {
    expect(readBearerSubprotocol(undefined)).toBeNull();
  });

  it('returns null when only one value is offered', () => {
    expect(readBearerSubprotocol('bearer')).toBeNull();
  });

  it('returns null when bearer marker is absent', () => {
    expect(readBearerSubprotocol('json, foo')).toBeNull();
  });

  it('parses the standard browser form', () => {
    expect(readBearerSubprotocol('bearer, mn_admin_abc')).toBe('mn_admin_abc');
  });

  it('is case-insensitive on the marker', () => {
    expect(readBearerSubprotocol('Bearer, mn_admin_abc')).toBe('mn_admin_abc');
  });

  it('honors the first bearer + token pair when more follow', () => {
    expect(readBearerSubprotocol('bearer, first, bearer, second')).toBe('first');
  });

  it('handles trailing commas and whitespace', () => {
    expect(readBearerSubprotocol('  bearer ,  mn_eu_xyz  , ')).toBe('mn_eu_xyz');
  });
});

describe('isOriginAllowedForCookieAuth', () => {
  const original = process.env.MUNIN_CORS_ORIGINS;

  beforeEach(() => {
    delete process.env.MUNIN_CORS_ORIGINS;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.MUNIN_CORS_ORIGINS;
    else process.env.MUNIN_CORS_ORIGINS = original;
  });

  it('rejects when Origin header is missing', () => {
    expect(isOriginAllowedForCookieAuth(undefined)).toBe(false);
  });

  it('accepts default dev origins when MUNIN_CORS_ORIGINS is unset', () => {
    expect(isOriginAllowedForCookieAuth('http://localhost:3000')).toBe(true);
  });

  it('rejects non-allowlisted origins', () => {
    process.env.MUNIN_CORS_ORIGINS = 'https://app.example.com';
    expect(isOriginAllowedForCookieAuth('https://evil.example')).toBe(false);
  });

  it('accepts explicit allowlist matches', () => {
    process.env.MUNIN_CORS_ORIGINS = 'https://app.example.com,https://www.example.com';
    expect(isOriginAllowedForCookieAuth('https://app.example.com')).toBe(true);
  });

  it('rejects everything when MUNIN_CORS_ORIGINS is * (wildcard never grants cookie origins)', () => {
    process.env.MUNIN_CORS_ORIGINS = '*';
    expect(isOriginAllowedForCookieAuth('https://anywhere.example')).toBe(false);
    expect(isOriginAllowedForCookieAuth('http://localhost:3000')).toBe(false);
  });
});

describe('widgetGateReason', () => {
  it('passes through the code-shaped message a widget gate throws', () => {
    expect(widgetGateReason(new ForbiddenException('identity_verification_failed'))).toBe(
      'identity_verification_failed',
    );
    expect(widgetGateReason(new ForbiddenException('identity_partial'))).toBe('identity_partial');
    expect(widgetGateReason(new Error('widget_channel_inactive'))).toBe(
      'widget_channel_inactive',
    );
  });

  it('never leaks prose or header-breaking characters', () => {
    expect(widgetGateReason(new Error('channel cch_1 is inactive'))).toBe('widget_gate_failed');
    expect(widgetGateReason(new Error('bad\r\nX-Injected: 1'))).toBe('widget_gate_failed');
    expect(widgetGateReason('Identity_Partial')).toBe('widget_gate_failed');
    expect(widgetGateReason(undefined)).toBe('widget_gate_failed');
  });
});
