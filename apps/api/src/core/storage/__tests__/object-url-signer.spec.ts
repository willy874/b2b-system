import { describe, expect, it, vi } from 'vitest';

import type { ObjectStorage } from '../object-storage';
import { PresignedUrlSigner } from '../object-url-signer';

function fakeStorage() {
  const presignDownload = vi.fn(async () => ({
    url: 'https://files.example.test/b/images/a/r1/sm.jpg?X-Amz-Signature=abc',
    method: 'GET' as const,
    headers: {},
    expiresAt: new Date('2026-10-09T12:00:00.000Z'),
  }));
  return { storage: { presignDownload } as unknown as ObjectStorage, presignDownload };
}

describe('PresignedUrlSigner（docs/architecture/backend/25-image.md §3 D6）', () => {
  it('包住 presignDownload：預設 inline，檔名取 key 的最後一段', async () => {
    const { storage, presignDownload } = fakeStorage();
    const signed = await new PresignedUrlSigner(storage).sign('images/a/r1/sm.jpg', {
      expiresIn: 3600,
    });

    expect(presignDownload).toHaveBeenCalledWith('images/a/r1/sm.jpg', {
      expiresIn: 3600,
      fileName: 'sm.jpg',
      disposition: 'inline',
      contentType: undefined,
    });
    expect(signed).toEqual({
      url: 'https://files.example.test/b/images/a/r1/sm.jpg?X-Amz-Signature=abc',
      expiresAt: new Date('2026-10-09T12:00:00.000Z'),
    });
  });

  it('帶下載的檔名與 disposition；cdn 只是提示，presigned 不使用', async () => {
    const { storage, presignDownload } = fakeStorage();
    await new PresignedUrlSigner(storage).sign('gallery/a/original', {
      expiresIn: 900,
      disposition: 'attachment',
      fileName: 'beach.jpg',
      contentType: 'image/jpeg',
      cdn: 'galleryItem',
    });

    expect(presignDownload).toHaveBeenCalledWith('gallery/a/original', {
      expiresIn: 900,
      fileName: 'beach.jpg',
      disposition: 'attachment',
      contentType: 'image/jpeg',
    });
  });
});
