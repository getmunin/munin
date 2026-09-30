import { describe, it, expect } from 'vitest';
import { CMS_ASSET_MIME_TYPES, checkCmsAssetType } from './asset-validation.ts';

describe('checkCmsAssetType', () => {
  it('never allows a type a browser renders as an active document', () => {
    for (const mime of [
      'text/html',
      'application/xhtml+xml',
      'text/xml',
      'application/xml',
      'image/svg+xml',
      'image/svg',
      'application/javascript',
      'text/javascript',
      'text/plain',
      'application/octet-stream',
      'multipart/related',
    ]) {
      expect(checkCmsAssetType('file', mime)).toMatchObject({ ok: false, reason: 'mime_not_allowed' });
    }
  });

  it('allows only raster image, video, audio and PDF mimes', () => {
    for (const mime of CMS_ASSET_MIME_TYPES) {
      expect(mime === 'application/pdf' || /^(image|video|audio)\//.test(mime)).toBe(true);
      expect(mime).not.toMatch(/svg|xml|html/);
    }
  });

  it('normalizes case and parameters before checking', () => {
    expect(checkCmsAssetType('a.png', ' IMAGE/PNG ; charset=binary')).toEqual({
      ok: true,
      mime: 'image/png',
      ext: 'png',
    });
    expect(checkCmsAssetType('page', 'Text/HTML; charset=utf-8')).toMatchObject({
      ok: false,
      mime: 'text/html',
    });
  });

  it('derives the extension from the mime when the name has none', () => {
    expect(checkCmsAssetType('banner', 'image/webp')).toEqual({ ok: true, mime: 'image/webp', ext: 'webp' });
    expect(checkCmsAssetType('voice', 'audio/mpeg')).toEqual({ ok: true, mime: 'audio/mpeg', ext: 'mp3' });
  });

  it('refuses an extension outside the mime family, including svg and html', () => {
    expect(checkCmsAssetType('logo.svg', 'image/png')).toMatchObject({ ok: false, reason: 'extension_mismatch' });
    expect(checkCmsAssetType('page.html', 'image/png')).toMatchObject({ ok: false, reason: 'extension_mismatch' });
    expect(checkCmsAssetType('clip.mp4', 'image/png')).toMatchObject({ ok: false, reason: 'extension_mismatch' });
    expect(checkCmsAssetType('doc.pdf', 'audio/mpeg')).toMatchObject({ ok: false, reason: 'extension_mismatch' });
  });

  it('tolerates a sibling extension within the same family', () => {
    expect(checkCmsAssetType('photo.PNG', 'image/jpeg')).toEqual({ ok: true, mime: 'image/jpeg', ext: 'png' });
    expect(checkCmsAssetType('clip.webm', 'audio/webm')).toEqual({ ok: true, mime: 'audio/webm', ext: 'webm' });
  });
});
