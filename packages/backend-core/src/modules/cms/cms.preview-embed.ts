import { safeFetch } from '@getmunin/core';
import { readWebBaseUrl } from '../credential-handoff/credential-handoff.constants.ts';

export type PreviewEmbedReason = 'ok' | 'frame_ancestors' | 'x_frame_options' | 'unreachable';

export interface PreviewEmbedDto {
  embeddable: boolean;
  reason: PreviewEmbedReason;
  detail: string | null;
  previewHost: string;
  embedderOrigin: string;
}

export interface FrameHeaders {
  csp: string | null;
  xfo: string | null;
}

const PROBE_TIMEOUT_MS = 5000;

function frameAncestorLists(csp: string | null): string[][] {
  if (!csp) return [];
  const lists: string[][] = [];
  for (const policy of csp.split(',')) {
    for (const directive of policy.split(';')) {
      const tokens = directive.trim().split(/\s+/).filter(Boolean);
      if (tokens[0]?.toLowerCase() === 'frame-ancestors') lists.push(tokens.slice(1));
    }
  }
  return lists;
}

function hostMatches(pattern: string, host: string): boolean {
  if (pattern === host) return true;
  if (!pattern.startsWith('*.')) return false;
  const suffix = pattern.slice(1);
  return host.endsWith(suffix) && host.length > suffix.length;
}

function defaultPort(protocol: string): string {
  return protocol === 'https:' ? '443' : '80';
}

export function sourceAllowsOrigin(source: string, embedder: URL): boolean {
  const token = source.trim();
  if (token === '*') return true;
  if (token.startsWith("'")) return false;
  if (/^[a-z][a-z0-9+.-]*:$/i.test(token)) return token.toLowerCase() === embedder.protocol;

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(token);
  let parsed: URL;
  try {
    parsed = new URL(hasScheme ? token : `${embedder.protocol}//${token}`);
  } catch {
    return false;
  }
  if (hasScheme && parsed.protocol !== embedder.protocol) return false;
  if (!hostMatches(parsed.hostname, embedder.hostname)) return false;
  if (parsed.port === '') return true;
  return parsed.port === (embedder.port || defaultPort(embedder.protocol));
}

export function evaluateFrameHeaders(
  headers: FrameHeaders,
  previewUrl: URL,
  embedder: URL,
): { embeddable: boolean; reason: PreviewEmbedReason; detail: string | null } {
  const lists = frameAncestorLists(headers.csp);
  if (lists.length > 0) {
    for (const sources of lists) {
      const allowed = sources.some((source) =>
        source.toLowerCase() === "'self'"
          ? previewUrl.origin === embedder.origin
          : sourceAllowsOrigin(source, embedder),
      );
      if (!allowed) {
        return { embeddable: false, reason: 'frame_ancestors', detail: sources.join(' ') };
      }
    }
    return { embeddable: true, reason: 'ok', detail: null };
  }

  const xfo = headers.xfo?.trim().toLowerCase() ?? null;
  if (xfo === 'deny') return { embeddable: false, reason: 'x_frame_options', detail: 'DENY' };
  if (xfo === 'sameorigin' && previewUrl.origin !== embedder.origin) {
    return { embeddable: false, reason: 'x_frame_options', detail: 'SAMEORIGIN' };
  }
  return { embeddable: true, reason: 'ok', detail: null };
}

export async function probePreviewEmbed(url: string): Promise<PreviewEmbedDto | null> {
  let previewUrl: URL;
  let embedder: URL;
  try {
    previewUrl = new URL(url);
    embedder = new URL(readWebBaseUrl());
  } catch {
    return null;
  }
  const where = { previewHost: previewUrl.host, embedderOrigin: embedder.origin };

  let headers: FrameHeaders;
  try {
    const res = await safeFetch(url, {
      method: 'GET',
      headers: { accept: 'text/html' },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    headers = {
      csp: res.headers.get('content-security-policy'),
      xfo: res.headers.get('x-frame-options'),
    };
    await res.body?.cancel().catch(() => undefined);
  } catch {
    return { embeddable: true, reason: 'unreachable', detail: null, ...where };
  }

  return { ...evaluateFrameHeaders(headers, previewUrl, embedder), ...where };
}
