import { stripTrailingSlashes } from '@getmunin/types';

export function readWebBaseUrl(): string {
  return stripTrailingSlashes(process.env.MUNIN_WEB_URL ?? 'http://localhost:3000');
}

export function credentialLinkUrl(token: string): string {
  return `${readWebBaseUrl()}/connect/credentials?token=${encodeURIComponent(token)}`;
}
