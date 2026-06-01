import { UnauthorizedException } from '@nestjs/common';
import { safeFetch } from '@getmunin/core';

export async function validateProviderCredentials(baseUrl: string, apiKey: string): Promise<void> {
  const root = baseUrl.replace(/\/+$/, '');
  if (/openrouter\.ai/i.test(baseUrl)) {
    const res = await safeFetch(`${root}/auth/key`, {
      headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
    });
    if (res.status === 401 || res.status === 403) {
      throw new UnauthorizedException(`provider rejected the API key (${res.status})`);
    }
    return;
  }
  const res = await safeFetch(`${root}/models`, { headers: authHeaders(baseUrl, apiKey) });
  if (res.status === 401 || res.status === 403) {
    throw new UnauthorizedException(`provider rejected the API key (${res.status})`);
  }
}

export function authHeaders(baseUrl: string, apiKey: string): Record<string, string> {
  if (/api\.anthropic\.com/i.test(baseUrl)) {
    return {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      accept: 'application/json',
    };
  }
  return {
    authorization: `Bearer ${apiKey}`,
    accept: 'application/json',
  };
}
