import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BadGatewayException, UnauthorizedException } from '@nestjs/common';
import * as core from '@getmunin/core';
import { stripTrailingSlashes, validateProviderCredentials } from './provider-auth.ts';

function mockSafeFetch(response: {
  status: number;
  body?: unknown;
  jsonThrows?: boolean;
}): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue({
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    json: () =>
      response.jsonThrows
        ? Promise.reject(new SyntaxError('Unexpected token < in JSON'))
        : Promise.resolve(response.body),
  });
  vi.spyOn(core, 'safeFetch').mockImplementation(fn);
  return fn;
}

const CUSTOM = 'https://provider.example/v1';

describe('validateProviderCredentials', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves when /models returns 200 with an OpenAI-compatible list', async () => {
    const fetchMock = mockSafeFetch({ status: 200, body: { data: [{ id: 'm-1' }] } });
    await expect(validateProviderCredentials(CUSTOM, 'sk-test')).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://provider.example/v1/models');
  });

  it('resolves when /models returns an empty list (provider has no models provisioned)', async () => {
    mockSafeFetch({ status: 200, body: { data: [] } });
    await expect(validateProviderCredentials(CUSTOM, 'sk-test')).resolves.toBeUndefined();
  });

  it('rejects with Unauthorized on 401', async () => {
    mockSafeFetch({ status: 401 });
    await expect(validateProviderCredentials(CUSTOM, 'bad-key')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects with Unauthorized on 403', async () => {
    mockSafeFetch({ status: 403 });
    await expect(validateProviderCredentials(CUSTOM, 'bad-key')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a bogus endpoint that returns 404 instead of silently accepting it', async () => {
    mockSafeFetch({ status: 404 });
    await expect(validateProviderCredentials(CUSTOM, 'sk-test')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('rejects on a 5xx upstream error', async () => {
    mockSafeFetch({ status: 503 });
    await expect(validateProviderCredentials(CUSTOM, 'sk-test')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('rejects a 200 response whose body is not JSON', async () => {
    mockSafeFetch({ status: 200, jsonThrows: true });
    await expect(validateProviderCredentials(CUSTOM, 'sk-test')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('rejects a 200 response that parses but is the wrong shape', async () => {
    mockSafeFetch({ status: 200, body: { unexpected: 'shape' } });
    await expect(validateProviderCredentials(CUSTOM, 'sk-test')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('rejects when the endpoint is unreachable (safeFetch throws)', async () => {
    vi.spyOn(core, 'safeFetch').mockRejectedValue(new Error('ENOTFOUND provider.bogus'));
    await expect(validateProviderCredentials(CUSTOM, 'sk-test')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('sends x-api-key + anthropic-version for api.anthropic.com', async () => {
    const fetchMock = mockSafeFetch({ status: 200, body: { data: [] } });
    await validateProviderCredentials('https://api.anthropic.com/v1', 'sk-ant-test');
    const init = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(init.headers['x-api-key']).toBe('sk-ant-test');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    expect(init.headers.authorization).toBeUndefined();
  });

  describe('OpenRouter', () => {
    const OR = 'https://openrouter.ai/api/v1';

    it('probes /auth/key and resolves on a recognizable key payload', async () => {
      const fetchMock = mockSafeFetch({
        status: 200,
        body: { data: { label: 'sk-or-...', usage: 0, limit: null } },
      });
      await expect(validateProviderCredentials(OR, 'sk-or-test')).resolves.toBeUndefined();
      expect(fetchMock.mock.calls[0]?.[0]).toBe('https://openrouter.ai/api/v1/auth/key');
    });

    it('rejects with Unauthorized when the key is bad', async () => {
      mockSafeFetch({ status: 401 });
      await expect(validateProviderCredentials(OR, 'bad-key')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects a 200 response that is not a key payload', async () => {
      mockSafeFetch({ status: 200, body: { data: [] } });
      await expect(validateProviderCredentials(OR, 'sk-or-test')).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    });
  });
});

describe('stripTrailingSlashes', () => {
  it('matches the trailing-slash semantics of the previous regex', () => {
    const cases = [
      'https://api.example.com/',
      'https://api.example.com///',
      'https://api.example.com',
      'https://api.example.com/v1',
      'https://api.example.com/v1/',
      '',
      '/',
      '////',
    ];
    for (const value of cases) {
      expect(stripTrailingSlashes(value)).toBe(value.replace(/\/+$/, ''));
    }
  });

  it('runs in linear time on pathological all-slash input', () => {
    const input = `${'/'.repeat(200_000)}a`;
    expect(stripTrailingSlashes(input)).toBe(input);
  });
});
