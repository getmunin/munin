import sharp from 'sharp';
import type { AssetStorage } from '@getmunin/core';
import type { AssetVariant } from '@getmunin/types';

export const VARIANT_LADDER_VERSION = 1;

const LADDER_WIDTHS = [320, 640, 1024, 1536, 2048];
const FULL_WIDTH_CAP = 2560;
const WEBP_QUALITY = 80;
const VARIANTABLE_MIME = /^image\/(jpeg|png|webp|gif|tiff)$/;

export interface MasterDimensions {
  width: number;
  height: number;
}

export interface RenderedVariant extends MasterDimensions {
  format: 'webp';
  body: Buffer;
}

export class UndecodableImageError extends Error {}

export function isVariantableMime(mime: string): boolean {
  return VARIANTABLE_MIME.test(mime.toLowerCase());
}

export function variantWidthsFor(sourceWidth: number): number[] {
  const widths = LADDER_WIDTHS.filter((w) => w < sourceWidth);
  const full = Math.min(sourceWidth, FULL_WIDTH_CAP);
  if (!widths.includes(full)) widths.push(full);
  return widths;
}

export async function probeMaster(body: Buffer): Promise<MasterDimensions> {
  const meta = await sharp(body)
    .metadata()
    .catch((err: unknown) => {
      throw new UndecodableImageError(describeSharpError(err));
    });
  if (!meta.width || !meta.height) {
    throw new UndecodableImageError('image reports no dimensions');
  }
  return { width: meta.width, height: meta.height };
}

export async function renderVariants(
  body: Buffer,
  source: MasterDimensions,
): Promise<RenderedVariant[]> {
  const out: RenderedVariant[] = [];
  for (const width of variantWidthsFor(source.width)) {
    const rendered = await sharp(body)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true })
      .catch((err: unknown) => {
        throw new UndecodableImageError(describeSharpError(err));
      });
    out.push({
      width: rendered.info.width,
      height: rendered.info.height,
      format: 'webp',
      body: rendered.data,
    });
  }
  return out;
}

export function variantKeyFor(masterKey: string, width: number): string {
  const base = masterKey.replace(/\.[^./]+$/, '');
  return `${base}-${width}w.webp`;
}

export interface VariantColumns {
  width: number | null;
  height: number | null;
  variants: AssetVariant[];
  variantsVersion: number;
}

export const NO_VARIANTS: VariantColumns = {
  width: null,
  height: null,
  variants: [],
  variantsVersion: VARIANT_LADDER_VERSION,
};

export async function deriveVariantColumns(
  storage: AssetStorage,
  input: { mime: string; storageKey: string; body: Buffer },
): Promise<VariantColumns> {
  if (!isVariantableMime(input.mime) || !storage.writeDirect) return NO_VARIANTS;

  const source = await probeMaster(input.body);
  const rendered = await renderVariants(input.body, source);

  const variants: AssetVariant[] = [];
  for (const variant of rendered) {
    const key = variantKeyFor(input.storageKey, variant.width);
    await storage.writeDirect(key, variant.body, { mime: 'image/webp' });
    variants.push({
      width: variant.width,
      height: variant.height,
      format: variant.format,
      storageKey: key,
      publicUrl: storage.publicUrlFor(key),
      sizeBytes: variant.body.length,
    });
  }

  return {
    width: source.width,
    height: source.height,
    variants,
    variantsVersion: VARIANT_LADDER_VERSION,
  };
}

export function widestVariantUrl(asset: {
  publicUrl: string;
  variants?: AssetVariant[] | null;
}): string {
  const widest = (asset.variants ?? []).reduce<AssetVariant | null>(
    (best, v) => (best === null || v.width > best.width ? v : best),
    null,
  );
  return widest?.publicUrl ?? asset.publicUrl;
}

function describeSharpError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
