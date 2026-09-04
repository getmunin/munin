import { generateKeyPairSync, randomBytes } from 'node:crypto';

export const DKIM_KEY_BITS = 2048;

export interface DkimKeyPair {
  selector: string;
  privateKeyPem: string;
  publicKeyPem: string;
}

export interface SendingIdentityDnsRecord {
  type: 'TXT';
  name: string;
  value: string;
}

export function mintSelector(): string {
  return `munin-${randomBytes(4).toString('hex')}`;
}

export function generateDkimKeyPair(selector = mintSelector()): DkimKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: DKIM_KEY_BITS,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { selector, privateKeyPem: privateKey, publicKeyPem: publicKey };
}

export function stripPem(pem: string): string {
  return pem
    .split('\n')
    .filter((line) => !line.startsWith('-----') && line.trim() !== '')
    .join('')
    .replace(/\s+/g, '');
}

export function dkimRecordName(selector: string, domain: string): string {
  return `${selector}._domainkey.${domain}`;
}

export function dkimRecordValue(publicKeyPem: string): string {
  return `v=DKIM1; k=rsa; p=${stripPem(publicKeyPem)}`;
}

export function dkimDnsRecord(
  selector: string,
  domain: string,
  publicKeyPem: string,
): SendingIdentityDnsRecord {
  return {
    type: 'TXT',
    name: dkimRecordName(selector, domain),
    value: dkimRecordValue(publicKeyPem),
  };
}

export function extractPublicKeyFromRecord(value: string): string | null {
  const normalised = value.replace(/\s+/g, '');
  const match = normalised.match(/(?:^|;)p=([A-Za-z0-9+/=]*)/);
  const key = match?.[1];
  return key ? key : null;
}

export function normaliseDomain(input: string): string | null {
  const trimmed = input.trim().toLowerCase().replace(/^@/, '').replace(/\.$/, '');
  if (!trimmed || trimmed.includes('@') || /\s/.test(trimmed)) return null;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function domainCoversAddress(domain: string, address: string): boolean {
  const addressDomain = address.split('@')[1]?.trim().toLowerCase();
  if (!addressDomain) return false;
  return addressDomain === domain || addressDomain.endsWith(`.${domain}`);
}

export interface DkimSignOptions {
  domainName: string;
  keySelector: string;
  privateKey: string;
}

export function buildDkimSignOptions(
  identity: { domain: string; selector: string },
  privateKeyPem: string | null,
): DkimSignOptions | null {
  if (!privateKeyPem?.includes('PRIVATE KEY')) return null;
  return {
    domainName: identity.domain,
    keySelector: identity.selector,
    privateKey: privateKeyPem,
  };
}
