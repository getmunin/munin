import { Injectable } from '@nestjs/common';

export const QUOTAS_SERVICE = Symbol('QUOTAS_SERVICE');

export class QuotaExceededError extends Error {
  readonly code = 'quota_exceeded';
  constructor(public readonly resource: string, public readonly cap: number) {
    super(`quota_exceeded: this org is at the ${resource} limit (${cap}). Upgrade or delete unused rows.`);
  }
}

export type QuotaResource =
  | 'kb_documents'
  | 'kb_spaces'
  | 'cms_collections'
  | 'cms_entries'
  | 'cms_assets'
  | 'crm_contacts';

export abstract class QuotasService {
  abstract assertCanAdd(resource: QuotaResource): Promise<void>;
  abstract recordCall(kind: string, key?: string): Promise<void>;
}

@Injectable()
export class DefaultQuotasService extends QuotasService {
  assertCanAdd(_resource: QuotaResource): Promise<void> {
    return Promise.resolve();
  }
  recordCall(_kind: string, _key?: string): Promise<void> {
    return Promise.resolve();
  }
}
