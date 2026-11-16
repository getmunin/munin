import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadToPresigned, type PreparedUpload, type PresignedUploadTarget } from './upload.ts';

const prepared: PreparedUpload = {
  blob: new Blob([new Uint8Array(4)], { type: 'image/png' }),
  name: 'photo.png',
  mime: 'image/png',
};

const postTarget: PresignedUploadTarget = {
  uploadUrl: 'https://s3.storage.example/bucket/?X-Amz-Signature=secret',
  uploadMethod: 'POST',
  uploadFields: { key: 'conv/a.png' },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('uploadToPresigned failures', () => {
  it('names the storage host and the CORS requirement when the request never completes', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    const err = await uploadToPresigned(postTarget, prepared).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'conv_attachment_upload_failed' });
    const message = (err as Error).message;
    expect(message).toContain('https://s3.storage.example/bucket/');
    expect(message).toContain('Failed to fetch');
    expect(message).toContain(`allow POST from ${location.origin}`);
  });

  it('keeps the presigned query string out of the error', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    const err = await uploadToPresigned(postTarget, prepared).catch((e: unknown) => e);
    expect((err as Error).message).not.toContain('X-Amz-Signature');
  });

  it('reports the status and storage host when the bucket refuses the upload', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('denied', { status: 403 }))));
    const err = await uploadToPresigned(postTarget, prepared).catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      'attachment upload failed: status 403 from https://s3.storage.example/bucket/',
    );
  });
});
