import { describe, expect, it } from 'vitest';
import { ProviderBaseUrl } from './config.controller.ts';

describe('agent-config providerBaseUrl validation', () => {
  it('accepts https:// urls', () => {
    expect(ProviderBaseUrl.safeParse('https://provider.example/v1').success).toBe(true);
  });

  it('rejects http:// urls when MUNIN_SSRF_ALLOW_PRIVATE is unset', () => {
    const prev = process.env.MUNIN_SSRF_ALLOW_PRIVATE;
    delete process.env.MUNIN_SSRF_ALLOW_PRIVATE;
    try {
      expect(ProviderBaseUrl.safeParse('http://provider.example/v1').success).toBe(false);
    } finally {
      if (prev !== undefined) process.env.MUNIN_SSRF_ALLOW_PRIVATE = prev;
    }
  });

  it('rejects http://localhost even with MUNIN_SSRF_ALLOW_PRIVATE unset', () => {
    const prev = process.env.MUNIN_SSRF_ALLOW_PRIVATE;
    delete process.env.MUNIN_SSRF_ALLOW_PRIVATE;
    try {
      expect(ProviderBaseUrl.safeParse('http://localhost:11434/v1').success).toBe(false);
    } finally {
      if (prev !== undefined) process.env.MUNIN_SSRF_ALLOW_PRIVATE = prev;
    }
  });

  it('allows http:// when MUNIN_SSRF_ALLOW_PRIVATE=true (dev escape hatch for ollama etc.)', () => {
    const prev = process.env.MUNIN_SSRF_ALLOW_PRIVATE;
    process.env.MUNIN_SSRF_ALLOW_PRIVATE = 'true';
    try {
      expect(ProviderBaseUrl.safeParse('http://localhost:11434/v1').success).toBe(true);
    } finally {
      if (prev !== undefined) process.env.MUNIN_SSRF_ALLOW_PRIVATE = prev;
      else delete process.env.MUNIN_SSRF_ALLOW_PRIVATE;
    }
  });

  it('rejects non-http(s) protocols even with the escape hatch', () => {
    const prev = process.env.MUNIN_SSRF_ALLOW_PRIVATE;
    process.env.MUNIN_SSRF_ALLOW_PRIVATE = 'true';
    try {
      expect(ProviderBaseUrl.safeParse('file:///etc/passwd').success).toBe(false);
      expect(ProviderBaseUrl.safeParse('gopher://provider.example/').success).toBe(false);
    } finally {
      if (prev !== undefined) process.env.MUNIN_SSRF_ALLOW_PRIVATE = prev;
      else delete process.env.MUNIN_SSRF_ALLOW_PRIVATE;
    }
  });
});
