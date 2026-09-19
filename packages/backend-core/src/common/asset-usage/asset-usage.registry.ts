import { Injectable } from '@nestjs/common';

export interface AssetUsageRef {
  kind: string;
  id: string;
  description: string;
}

export interface AssetUsageProvider {
  usageFor(args: { assetId: string; publicUrl: string }): Promise<AssetUsageRef[]>;
}

@Injectable()
export class AssetUsageRegistry {
  private readonly providers: AssetUsageProvider[] = [];

  register(provider: AssetUsageProvider): void {
    this.providers.push(provider);
  }

  async usageFor(args: { assetId: string; publicUrl: string }): Promise<AssetUsageRef[]> {
    const found: AssetUsageRef[] = [];
    for (const provider of this.providers) {
      found.push(...(await provider.usageFor(args)));
    }
    return found;
  }
}
