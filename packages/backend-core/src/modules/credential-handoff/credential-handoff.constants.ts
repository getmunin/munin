import { readWebBaseUrl } from '../../common/web-url.ts';

export { readWebBaseUrl };

export function credentialLinkUrl(token: string): string {
  return `${readWebBaseUrl()}/connect/credentials?token=${encodeURIComponent(token)}`;
}
