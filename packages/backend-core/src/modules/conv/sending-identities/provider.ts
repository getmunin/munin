import type { SendingIdentityDnsRecord } from './dkim-key.ts';

export const SENDING_IDENTITY_PROVIDER = Symbol('SENDING_IDENTITY_PROVIDER');

export type SendingIdentityStatus = 'pending' | 'verified' | 'failed';

export interface SendingIdentityKeyMaterial {
  domain: string;
  selector: string;
  privateKeyPem: string;
  publicKeyPem: string;
}

export interface SendingIdentityProvisionResult {
  providerRef: string | null;
  extraRecords?: SendingIdentityDnsRecord[];
}

export interface SendingIdentityRefreshResult {
  status: SendingIdentityStatus;
  detail?: string;
}

export interface SendingIdentityProvider {
  readonly name: string;
  readonly signsOutbound: boolean;
  provision(material: SendingIdentityKeyMaterial): Promise<SendingIdentityProvisionResult>;
  refresh(input: {
    domain: string;
    selector: string;
    publicKeyPem: string;
    providerRef: string | null;
  }): Promise<SendingIdentityRefreshResult>;
  revoke(input: { domain: string; providerRef: string | null }): Promise<void>;
}
