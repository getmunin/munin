import { ForbiddenException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { enforceOriginAllowlist } from './widget-ingest.service.ts';

describe('enforceOriginAllowlist', () => {
  let original: string | undefined;
  beforeEach(() => {
    original = process.env.MUNIN_WIDGET_REQUIRE_ALLOWLIST;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.MUNIN_WIDGET_REQUIRE_ALLOWLIST;
    else process.env.MUNIN_WIDGET_REQUIRE_ALLOWLIST = original;
  });

  it('rejects all origins when the allowlist is empty (secure default)', () => {
    delete process.env.MUNIN_WIDGET_REQUIRE_ALLOWLIST;
    expect(() =>
      enforceOriginAllowlist({ originAllowlist: [] }, 'https://attacker.example'),
    ).toThrow(ForbiddenException);
  });

  it('allows an empty allowlist only when require-allowlist is explicitly disabled', () => {
    process.env.MUNIN_WIDGET_REQUIRE_ALLOWLIST = '0';
    expect(() =>
      enforceOriginAllowlist({ originAllowlist: [] }, 'https://attacker.example'),
    ).not.toThrow();
  });

  it('rejects all origins when allowlist is empty and require-allowlist is set', () => {
    process.env.MUNIN_WIDGET_REQUIRE_ALLOWLIST = '1';
    expect(() =>
      enforceOriginAllowlist({ originAllowlist: [] }, 'https://customer.example'),
    ).toThrow(ForbiddenException);
  });

  it('matches an origin against the allowlist', () => {
    expect(() =>
      enforceOriginAllowlist(
        { originAllowlist: ['https://customer.example'] },
        'https://customer.example',
      ),
    ).not.toThrow();
  });

  it('rejects an origin not on the allowlist regardless of the env var', () => {
    expect(() =>
      enforceOriginAllowlist(
        { originAllowlist: ['https://customer.example'] },
        'https://attacker.example',
      ),
    ).toThrow(ForbiddenException);
  });

  it('requires an Origin header when allowlist is non-empty', () => {
    expect(() =>
      enforceOriginAllowlist({ originAllowlist: ['https://customer.example'] }, undefined),
    ).toThrow(ForbiddenException);
  });
});
