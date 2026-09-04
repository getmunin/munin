import { Injectable, Logger } from '@nestjs/common';
import { resolveTxt } from 'node:dns/promises';
import { dkimRecordName, extractPublicKeyFromRecord, stripPem } from './dkim-key.ts';
import type {
  SendingIdentityKeyMaterial,
  SendingIdentityProvider,
  SendingIdentityProvisionResult,
  SendingIdentityRefreshResult,
} from './provider.ts';

export type TxtResolver = (hostname: string) => Promise<string[][]>;

@Injectable()
export class DnsProbeSendingIdentityProvider implements SendingIdentityProvider {
  readonly name = 'dns';
  readonly signsOutbound = false;

  private readonly logger = new Logger(DnsProbeSendingIdentityProvider.name);
  private resolver: TxtResolver = resolveTxt;

  setResolver(resolver: TxtResolver): void {
    this.resolver = resolver;
  }

  provision(_material: SendingIdentityKeyMaterial): Promise<SendingIdentityProvisionResult> {
    return Promise.resolve({ providerRef: null });
  }

  async refresh(input: {
    domain: string;
    selector: string;
    publicKeyPem: string;
  }): Promise<SendingIdentityRefreshResult> {
    const host = dkimRecordName(input.selector, input.domain);
    let chunks: string[][];
    try {
      chunks = await this.resolver(host);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'ENOTFOUND' || code === 'ENODATA') {
        return { status: 'pending', detail: `no TXT record at ${host} yet` };
      }
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`dkim lookup failed for ${host}: ${message}`);
      return { status: 'pending', detail: `lookup failed: ${message}` };
    }

    const expected = stripPem(input.publicKeyPem);
    for (const parts of chunks) {
      const published = extractPublicKeyFromRecord(parts.join(''));
      if (published && published === expected) return { status: 'verified' };
    }
    if (chunks.length === 0) {
      return { status: 'pending', detail: `no TXT record at ${host} yet` };
    }
    return {
      status: 'pending',
      detail: `a TXT record exists at ${host} but its p= value does not match this identity's key`,
    };
  }

  revoke(): Promise<void> {
    return Promise.resolve();
  }
}
