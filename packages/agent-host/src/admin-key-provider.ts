import { Injectable } from '@nestjs/common';

export interface AdminKeyProvider {
  mint(configId: string): Promise<void>;
  revoke(configId: string, adminApiKeyId: string): Promise<void>;
}

@Injectable()
export class NoopAdminKeyProvider implements AdminKeyProvider {
  async mint(): Promise<void> {}
  async revoke(): Promise<void> {}
}
