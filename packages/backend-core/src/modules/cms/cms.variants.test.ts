import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import type { AssetStorage, PresignedUploadHandle } from '@getmunin/core';
import {
  NO_VARIANTS,
  UndecodableImageError,
  VARIANT_LADDER_VERSION,
  deriveVariantColumns,
  isVariantableMime,
  probeMaster,
  renderVariants,
  variantKeyFor,
  variantWidthsFor,
  widestVariantUrl,
} from './cms.variants.ts';

class MemoryStorage implements AssetStorage {
  readonly provider = 's3';
  readonly written = new Map<string, Buffer>();

  presignedUpload(opts: { key: string }): Promise<PresignedUploadHandle> {
    return Promise.resolve({
      uploadUrl: `https://upload.test/${opts.key}`,
      uploadMethod: 'PUT',
      uploadFields: {},
      publicUrl: this.publicUrlFor(opts.key),
      expiresAt: new Date(0),
    });
  }

  delete(key: string): Promise<void> {
    this.written.delete(key);
    return Promise.resolve();
  }

  publicUrlFor(key: string): string {
    return `https://cdn.test/${key}`;
  }

  writeDirect(key: string, body: Buffer): Promise<void> {
    this.written.set(key, body);
    return Promise.resolve();
  }

  readBytes(key: string): Promise<Buffer | null> {
    return Promise.resolve(this.written.get(key) ?? null);
  }

  statBytes(key: string): Promise<number | null> {
    return Promise.resolve(this.written.get(key)?.length ?? null);
  }
}

function master(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 90, g: 120, b: 200 } },
  })
    .png()
    .toBuffer();
}

function noisyJpegMaster(width: number, height: number, quality = 70): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 128, g: 128, b: 128 },
      noise: { type: 'gaussian', mean: 128, sigma: 60 },
    },
  })
    .jpeg({ quality })
    .toBuffer();
}

describe('variantWidthsFor', () => {
  it('never upscales past the source width', () => {
    expect(variantWidthsFor(1536)).toEqual([320, 640, 1024, 1536]);
  });

  it('emits a single recompressed rendition for a source below the ladder', () => {
    expect(variantWidthsFor(200)).toEqual([200]);
  });

  it('does not duplicate a source width that is already a ladder rung', () => {
    expect(variantWidthsFor(1024)).toEqual([320, 640, 1024]);
  });

  it('caps the full-size rendition so huge masters do not get a huge variant', () => {
    expect(variantWidthsFor(6000)).toEqual([320, 640, 1024, 1536, 2048, 2560]);
  });
});

describe('isVariantableMime', () => {
  it('accepts raster images and rejects everything else', () => {
    expect(isVariantableMime('image/png')).toBe(true);
    expect(isVariantableMime('IMAGE/JPEG')).toBe(true);
    expect(isVariantableMime('image/svg+xml')).toBe(false);
    expect(isVariantableMime('application/pdf')).toBe(false);
    expect(isVariantableMime('video/mp4')).toBe(false);
  });
});

describe('probeMaster', () => {
  it('reads dimensions off real bytes', async () => {
    await expect(probeMaster(await master(640, 480))).resolves.toEqual({
      width: 640,
      height: 480,
    });
  });

  it('raises UndecodableImageError for bytes that are not an image', async () => {
    await expect(probeMaster(Buffer.from('not an image'))).rejects.toBeInstanceOf(
      UndecodableImageError,
    );
  });
});

describe('renderVariants', () => {
  it('renders webp at each ladder width without enlarging', async () => {
    const body = await master(800, 400);
    const rendered = await renderVariants(body, { width: 800, height: 400 });

    expect(rendered.map((v) => v.width)).toEqual([320, 640, 800]);
    expect(rendered.every((v) => v.format === 'webp')).toBe(true);
    for (const variant of rendered) {
      const meta = await sharp(variant.body).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.width).toBe(variant.width);
    }
  });

  it('preserves aspect ratio', async () => {
    const rendered = await renderVariants(await master(1000, 500), {
      width: 1000,
      height: 500,
    });
    const at640 = rendered.find((v) => v.width === 640);
    expect(at640?.height).toBe(320);
  });
});

describe('variantKeyFor', () => {
  it('derives a sibling key from the master key', () => {
    expect(variantKeyFor('cms/org_1/abc.png', 640)).toBe('cms/org_1/abc-640w.webp');
  });

  it('handles keys without an extension', () => {
    expect(variantKeyFor('cms/org_1/abc', 640)).toBe('cms/org_1/abc-640w.webp');
  });
});

describe('deriveVariantColumns', () => {
  it('writes every variant to storage and returns them at the current version', async () => {
    const storage = new MemoryStorage();
    const columns = await deriveVariantColumns(storage, {
      mime: 'image/png',
      storageKey: 'cms/org_1/hero.png',
      body: await master(1536, 1024),
    });

    expect(columns.width).toBe(1536);
    expect(columns.height).toBe(1024);
    expect(columns.variantsVersion).toBe(VARIANT_LADDER_VERSION);
    expect(columns.variants.map((v) => v.width)).toEqual([320, 640, 1024, 1536]);
    expect([...storage.written.keys()]).toEqual([
      'cms/org_1/hero-320w.webp',
      'cms/org_1/hero-640w.webp',
      'cms/org_1/hero-1024w.webp',
      'cms/org_1/hero-1536w.webp',
    ]);
    for (const variant of columns.variants) {
      expect(variant.sizeBytes).toBe(storage.written.get(variant.storageKey)?.length);
      expect(variant.publicUrl).toBe(`https://cdn.test/${variant.storageKey}`);
    }
  });

  it('every variant is lighter than the master', async () => {
    const storage = new MemoryStorage();
    const body = await master(1536, 1024);
    const columns = await deriveVariantColumns(storage, {
      mime: 'image/png',
      storageKey: 'cms/org_1/hero.png',
      body,
    });
    for (const variant of columns.variants) {
      expect(variant.sizeBytes).toBeLessThan(body.length);
    }
  });

  it('drops a rendition that recompresses heavier than an already-efficient master', async () => {
    const storage = new MemoryStorage();
    const body = await noisyJpegMaster(1200, 800);
    const columns = await deriveVariantColumns(storage, {
      mime: 'image/jpeg',
      storageKey: 'cms/org_1/noisy.jpg',
      body,
    });

    expect(columns.variants.length).toBeGreaterThan(0);
    for (const variant of columns.variants) {
      expect(variant.sizeBytes).toBeLessThan(body.length);
    }
    expect(columns.variants.some((v) => v.width === 1200)).toBe(false);
    expect([...storage.written.keys()]).not.toContain('cms/org_1/noisy-1200w.webp');
  });

  it('removes a superseded rendition left behind by an earlier ladder version', async () => {
    const storage = new MemoryStorage();
    const body = await noisyJpegMaster(1200, 800);
    const stale = 'cms/org_1/noisy-1200w.webp';
    await storage.writeDirect(stale, Buffer.alloc(999_999));

    await deriveVariantColumns(storage, {
      mime: 'image/jpeg',
      storageKey: 'cms/org_1/noisy.jpg',
      body,
    });

    expect(storage.written.has(stale)).toBe(false);
  });

  it('settles non-images without touching storage', async () => {
    const storage = new MemoryStorage();
    await expect(
      deriveVariantColumns(storage, {
        mime: 'application/pdf',
        storageKey: 'cms/org_1/doc.pdf',
        body: Buffer.from('%PDF-1.7'),
      }),
    ).resolves.toEqual(NO_VARIANTS);
    expect(storage.written.size).toBe(0);
  });

  it('raises UndecodableImageError when an image mime carries junk bytes', async () => {
    await expect(
      deriveVariantColumns(new MemoryStorage(), {
        mime: 'image/png',
        storageKey: 'cms/org_1/broken.png',
        body: Buffer.from('definitely not a png'),
      }),
    ).rejects.toBeInstanceOf(UndecodableImageError);
  });
});

describe('widestVariantUrl', () => {
  const variant = (width: number) => ({
    width,
    height: width,
    format: 'webp' as const,
    storageKey: `k-${width}`,
    publicUrl: `https://cdn.test/k-${width}`,
    sizeBytes: width,
  });

  it('picks the widest variant regardless of order', () => {
    expect(
      widestVariantUrl({
        publicUrl: 'https://cdn.test/master.png',
        variants: [variant(640), variant(1536), variant(320)],
      }),
    ).toBe('https://cdn.test/k-1536');
  });

  it('falls back to the master when there are no variants', () => {
    expect(widestVariantUrl({ publicUrl: 'https://cdn.test/master.png', variants: [] })).toBe(
      'https://cdn.test/master.png',
    );
    expect(widestVariantUrl({ publicUrl: 'https://cdn.test/master.png' })).toBe(
      'https://cdn.test/master.png',
    );
  });
});
