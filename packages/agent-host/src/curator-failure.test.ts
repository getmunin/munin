import { describe, expect, it } from 'vitest';
import { curatorFailureDisposition } from './curator-failure.ts';

describe('curatorFailureDisposition', () => {
  it('retries a provider outage and counts it against provider health', () => {
    expect(
      curatorFailureDisposition({ ok: false, skipped: 'provider_error', code: 'provider_other' }),
    ).toEqual({ retryable: true, providerHealthFailure: true });
  });

  it('fails a context-window overflow for good without touching provider health', () => {
    expect(
      curatorFailureDisposition({
        ok: false,
        skipped: 'provider_error',
        code: 'provider_context_length',
      }),
    ).toEqual({ retryable: false, providerHealthFailure: false });
  });

  it('does not retry a job whose skill has no tool allow-list', () => {
    expect(curatorFailureDisposition({ ok: false, skipped: 'no_tool_allowlist' })).toEqual({
      retryable: false,
      providerHealthFailure: false,
    });
  });

  it('retries an agent error without blaming the provider', () => {
    expect(curatorFailureDisposition({ ok: false, skipped: 'agent_error' })).toEqual({
      retryable: true,
      providerHealthFailure: false,
    });
  });
});
