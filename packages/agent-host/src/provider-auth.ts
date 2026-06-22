import { BadGatewayException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { describeError, safeFetch } from '@getmunin/core';

export function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end -= 1;
  return value.slice(0, end);
}

export async function validateProviderCredentials(baseUrl: string, apiKey: string): Promise<void> {
  const root = stripTrailingSlashes(baseUrl);
  if (/openrouter\.ai/i.test(baseUrl)) {
    const body = await probe(`${root}/auth/key`, authHeaders(baseUrl, apiKey));
    if (!hasObjectData(body)) {
      throw new BadGatewayException(
        'provider responded but did not return a recognizable OpenRouter key payload',
      );
    }
    return;
  }
  const body = await probe(`${root}/models`, authHeaders(baseUrl, apiKey));
  if (!hasArrayData(body)) {
    throw new BadGatewayException(
      'provider responded but did not return an OpenAI-compatible model list',
    );
  }
}

async function probe(url: string, headers: Record<string, string>): Promise<unknown> {
  let res: Awaited<ReturnType<typeof safeFetch>>;
  try {
    res = await safeFetch(url, { method: 'GET', headers });
  } catch (err) {
    throw new BadGatewayException(`could not reach the provider (${describeError(err)})`);
  }
  const authRejected: number[] = [HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN];
  if (authRejected.includes(res.status)) {
    throw new UnauthorizedException(`provider rejected the API key (${res.status})`);
  }
  if (!res.ok) {
    throw new BadGatewayException(`provider returned HTTP ${res.status}`);
  }
  try {
    return await res.json();
  } catch (err) {
    throw new BadGatewayException(`provider returned a non-JSON response (${describeError(err)})`);
  }
}

function hasArrayData(body: unknown): boolean {
  return !!body && typeof body === 'object' && Array.isArray((body as { data?: unknown }).data);
}

function hasObjectData(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const data = (body as { data?: unknown }).data;
  return !!data && typeof data === 'object' && !Array.isArray(data);
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
