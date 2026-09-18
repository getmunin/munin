import type { AssetStorage } from '@getmunin/core';

export class StubAssetStorage implements AssetStorage {
  readonly provider = 'local' as const;
  readonly deletes: string[] = [];
  readonly objects = new Map<string, number>();
  readonly bytes = new Map<string, Buffer>();
  readonly directWrites: { key: string; size: number; mime?: string }[] = [];

  presignedUpload(opts: { key: string; mime: string; sizeBytes: number }) {
    return Promise.resolve({
      uploadUrl: `https://upload.test/${opts.key}`,
      uploadMethod: 'PUT' as const,
      uploadFields: {},
      publicUrl: `https://cdn.test/${opts.key}`,
      expiresAt: new Date(Date.now() + 60_000),
    });
  }

  delete(key: string): Promise<void> {
    this.deletes.push(key);
    this.objects.delete(key);
    return Promise.resolve();
  }

  publicUrlFor(key: string): string {
    return `https://cdn.test/${key}`;
  }

  readBytes(key: string): Promise<Buffer | null> {
    return Promise.resolve(this.bytes.get(key) ?? null);
  }

  statBytes(key: string): Promise<number | null> {
    return Promise.resolve(this.objects.get(key) ?? null);
  }

  setObject(key: string, sizeBytes: number): void {
    this.objects.set(key, sizeBytes);
  }

  writeDirect(key: string, body: Buffer, opts?: { mime?: string }): Promise<void> {
    this.directWrites.push({ key, size: body.length, mime: opts?.mime });
    this.objects.set(key, body.length);
    this.bytes.set(key, body);
    return Promise.resolve();
  }
}
