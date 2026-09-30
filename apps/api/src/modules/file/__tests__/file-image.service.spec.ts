import { PassThrough, Readable } from 'node:stream';

import type { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import type { Env } from '@/core/config';
import { AppException } from '@/core/errors';
import type { DomainEventBus } from '@/core/events';
import { SharpImageProcessor } from '@/core/image/sharp-image-processor';
import type { ObjectStorage } from '@/core/storage';
import type { FileRow } from '@/db/schema';

import { negotiateFormat, FileImageService } from '../file-image.service';
import { IMAGE_VARIANT_ANNOUNCE_WAIT_MS, storageKeyOf, variantKeyOf } from '../file.constants';
import type { FileRepository } from '../file.repository';

const FILE_ID = '33333333-3333-4333-8333-333333333333';
const JWT_SECRET = 'x'.repeat(32);

function fileRow(overrides: Partial<FileRow> = {}): FileRow {
  const now = new Date('2026-09-27T00:00:00Z');
  return {
    id: FILE_ID,
    name: 'hero.png',
    contentType: 'image/png',
    size: 10,
    storageKey: storageKeyOf(FILE_ID),
    etag: 'e',
    status: 'ready',
    uploadedAt: now,
    uploadId: null,
    hasThumbnail: false,
    version: 1,
    variantStatus: 'pending',
    imageWidth: null,
    imageHeight: null,
    variantFormat: null,
    folderId: null,
    createdAt: now,
    createdBy: null,
    updatedAt: now,
    updatedBy: null,
    deletedAt: null,
    ...overrides,
  };
}

/** 記憶體版的物件儲存：只實作這個 service 用到的方法。 */
function memoryStorage() {
  const objects = new Map<string, { data: Buffer; contentType: string }>();
  return {
    objects,
    getObject: vi.fn(async (key: string) => {
      const object = objects.get(key);
      return object && Readable.from([object.data]);
    }),
    putObject: vi.fn(async (key: string, data: Buffer, options: { contentType: string }) => {
      objects.set(key, { data, contentType: options.contentType });
    }),
    head: vi.fn(async (key: string) => {
      const object = objects.get(key);
      return object && { size: object.data.length, etag: 'e', contentType: object.contentType };
    }),
    delete: vi.fn(async (key: string) => {
      objects.delete(key);
    }),
    async *listObjects(prefix: string) {
      for (const key of [...objects.keys()].toSorted()) {
        if (key.startsWith(prefix)) yield { key, size: 0, lastModified: new Date() };
      }
    },
    presignDownload: vi.fn(async (key: string) => ({
      url: `http://storage/${key}`,
      method: 'GET' as const,
      headers: {},
      expiresAt: new Date(Date.now() + 450_000),
    })),
  };
}

function setup(file: FileRow | undefined) {
  let row = file;
  const repo = {
    findById: vi.fn(async () => row),
    markVariantsReady: vi.fn(async (_id: string, values: Partial<FileRow>) => {
      if (!row || row.deletedAt) return undefined;
      row = { ...row, ...values, variantStatus: 'ready' };
      return row;
    }),
    markVariantsFailed: vi.fn(async () => {
      if (row) row = { ...row, variantStatus: 'failed' };
    }),
  };
  const storage = memoryStorage();
  const events = { publish: vi.fn() };
  const config = {
    get: vi.fn(
      (key: keyof Env) =>
        ({ JWT_SECRET, FILE_URL_TTL: 900, API_PUBLIC_BASE_URL: '/api' })[key as string],
    ),
  };
  const service = new FileImageService(
    repo as unknown as FileRepository,
    storage as unknown as ObjectStorage,
    new SharpImageProcessor(),
    events as unknown as DomainEventBus,
    config as unknown as ConfigService<Env, true>,
  );
  return { service, repo, storage, events, current: () => row };
}

async function png(width: number, height: number, alpha = false): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: alpha ? 4 : 3,
      background: alpha ? { r: 0, g: 0, b: 255, alpha: 0.5 } : '#0000ff',
    },
  })
    .png()
    .toBuffer();
}

/** 內容由測試決定何時送達的串流（模擬很慢的原圖下載）。 */
function deferredStream() {
  const stream = new PassThrough();
  return { stream, end: (data: Buffer) => stream.end(data) };
}

/** 從影像網址取出 query（`exp`、`sig`）。 */
function queryOf(url: string) {
  const params = new URL(url, 'http://x').searchParams;
  return { exp: Number(params.get('exp')), sig: params.get('sig') ?? '' };
}

/** 取出 AppException 的錯誤碼；沒拋錯時為 undefined。 */
const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: unknown) => (error as AppException).code,
  );

describe('FileImageService：產生變體', () => {
  it('實體化全螢幕預覽與圖示預覽（progressive JPEG），記下尺寸並推播 UPDATE', async () => {
    const { service, storage, events, current } = setup(fileRow());
    storage.objects.set(storageKeyOf(FILE_ID), {
      data: await png(4000, 3000),
      contentType: 'image/png',
    });

    service.schedule(FILE_ID);
    await service.whenIdle();

    expect(current()).toMatchObject({
      variantStatus: 'ready',
      imageWidth: 4000,
      imageHeight: 3000,
      variantFormat: 'jpeg',
    });
    const preview = storage.objects.get(variantKeyOf(FILE_ID, 'preview', 'jpeg'));
    const thumbnail = storage.objects.get(variantKeyOf(FILE_ID, 'thumbnail', 'jpeg'));
    expect(preview?.contentType).toBe('image/jpeg');
    await expect(sharp(preview?.data).metadata()).resolves.toMatchObject({
      width: 2560,
      height: 1920,
      isProgressive: true,
    });
    await expect(sharp(thumbnail?.data).metadata()).resolves.toMatchObject({
      width: 480,
      height: 360,
      isProgressive: true,
    });
    expect(events.publish).toHaveBeenCalledWith('resource.changed', {
      changes: [{ resource: 'file', kind: 'update', id: FILE_ID, refs: { fileFolder: ['root'] } }],
    });
  });

  it('剛上傳的圖片（announce）：變體很快就好 → 只推一次 create，不再推 update（PERF-06）', async () => {
    const { service, storage, events, current } = setup(fileRow());
    storage.objects.set(storageKeyOf(FILE_ID), {
      data: await png(10, 10),
      contentType: 'image/png',
    });
    service.schedule(FILE_ID, { announce: { folderId: null } });
    await service.whenIdle();
    expect(current()?.variantStatus).toBe('ready');
    expect(events.publish).toHaveBeenCalledTimes(1);
    expect(events.publish).toHaveBeenCalledWith('resource.changed', {
      changes: [{ resource: 'file', kind: 'create', id: FILE_ID, refs: { fileFolder: ['root'] } }],
    });
  });

  it('剛上傳的圖片：變體超過等待時間 → 先推 create，好了再推 update', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { service, storage, events } = setup(fileRow());
      const source = deferredStream();
      storage.getObject.mockImplementationOnce(async () => source.stream);
      service.schedule(FILE_ID, { announce: { folderId: 'f1' } });
      await vi.advanceTimersByTimeAsync(IMAGE_VARIANT_ANNOUNCE_WAIT_MS);
      expect(events.publish).toHaveBeenCalledTimes(1);
      expect(events.publish).toHaveBeenLastCalledWith('resource.changed', {
        changes: [{ resource: 'file', kind: 'create', id: FILE_ID, refs: { fileFolder: ['f1'] } }],
      });

      source.end(await png(10, 10));
      vi.useRealTimers();
      await service.whenIdle();
      expect(events.publish).toHaveBeenCalledTimes(2);
      expect(events.publish).toHaveBeenLastCalledWith(
        'resource.changed',
        expect.objectContaining({ changes: [expect.objectContaining({ kind: 'update' })] }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('剛上傳的圖片：變體失敗也照樣推 create（其他人要看得到這個檔案）', async () => {
    const { service, storage, events, current } = setup(fileRow());
    storage.objects.set(storageKeyOf(FILE_ID), {
      data: Buffer.from('nope'),
      contentType: 'image/png',
    });
    service.schedule(FILE_ID, { announce: { folderId: null } });
    await service.whenIdle();
    expect(current()?.variantStatus).toBe('failed');
    expect(events.publish).toHaveBeenCalledTimes(1);
    expect(events.publish).toHaveBeenCalledWith(
      'resource.changed',
      expect.objectContaining({ changes: [expect.objectContaining({ kind: 'create' })] }),
    );
  });

  it('有透明度的圖改用 WebP 當主格式', async () => {
    const { service, storage, current } = setup(fileRow());
    storage.objects.set(storageKeyOf(FILE_ID), {
      data: await png(10, 10, true),
      contentType: 'image/png',
    });
    service.schedule(FILE_ID);
    await service.whenIdle();
    expect(current()?.variantFormat).toBe('webp');
    expect(storage.objects.has(variantKeyOf(FILE_ID, 'preview', 'webp'))).toBe(true);
  });

  it('無法解碼 → failed，不推播', async () => {
    const { service, storage, events, current } = setup(fileRow());
    storage.objects.set(storageKeyOf(FILE_ID), {
      data: Buffer.from('nope'),
      contentType: 'image/png',
    });
    service.schedule(FILE_ID);
    await service.whenIdle();
    expect(current()?.variantStatus).toBe('failed');
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('儲存服務不可用 → 維持 pending，留給維護排程重試', async () => {
    const { service, storage, repo, current } = setup(fileRow());
    storage.getObject.mockRejectedValueOnce(new AppException('FILE_STORAGE_UNAVAILABLE'));
    service.schedule(FILE_ID);
    await service.whenIdle();
    expect(current()?.variantStatus).toBe('pending');
    expect(repo.markVariantsFailed).not.toHaveBeenCalled();
  });

  it('產生途中檔案被刪除 → 清掉剛寫入的變體', async () => {
    const { service, storage, repo } = setup(fileRow());
    storage.objects.set(storageKeyOf(FILE_ID), {
      data: await png(10, 10),
      contentType: 'image/png',
    });
    repo.markVariantsReady.mockResolvedValueOnce(undefined);
    service.schedule(FILE_ID);
    await service.whenIdle();
    expect([...storage.objects.keys()]).toEqual([storageKeyOf(FILE_ID)]);
  });

  it('同一個檔案重複排入只產生一次；不是 pending 的不處理', async () => {
    const { service, storage } = setup(fileRow());
    storage.objects.set(storageKeyOf(FILE_ID), {
      data: await png(10, 10),
      contentType: 'image/png',
    });
    service.schedule(FILE_ID);
    service.schedule(FILE_ID);
    await service.whenIdle();
    service.schedule(FILE_ID);
    await service.whenIdle();
    expect(storage.putObject).toHaveBeenCalledTimes(2);
  });
});

describe('FileImageService：影像 API', () => {
  const ready = () =>
    fileRow({ variantStatus: 'ready', imageWidth: 400, imageHeight: 300, variantFormat: 'jpeg' });

  it('signedUrls：變體 ready 才有；三個網址各自簽章', () => {
    const { service } = setup(undefined);
    expect(service.signedUrls(fileRow())).toBeNull();
    const image = service.signedUrls(ready());
    expect(image).toMatchObject({ width: 400, height: 300 });
    expect(image?.previewUrl).toMatch(
      new RegExp(`^/api/files/${FILE_ID}/image/preview\\?exp=\\d+&sig=`),
    );
    expect(queryOf(image?.previewUrl ?? '').sig).not.toBe(queryOf(image?.thumbnailUrl ?? '').sig);
  });

  it('不指定格式 → 轉址到主格式的變體；原圖原封不動', async () => {
    const { service } = setup(ready());
    const image = service.signedUrls(ready());
    const preview = await service.resolve(
      FILE_ID,
      'preview',
      queryOf(image?.previewUrl ?? ''),
      undefined,
    );
    expect(preview.url).toBe(`http://storage/${variantKeyOf(FILE_ID, 'preview', 'jpeg')}`);
    expect(preview.maxAge).toBeGreaterThan(0);
    const original = await service.resolve(
      FILE_ID,
      'original',
      queryOf(image?.originalUrl ?? ''),
      undefined,
    );
    expect(original.url).toBe(`http://storage/${storageKeyOf(FILE_ID)}`);
  });

  it('其他格式第一次被要求時才轉出並存起來，之後直接用', async () => {
    const { service, storage } = setup(ready());
    storage.objects.set(storageKeyOf(FILE_ID), {
      data: await png(4000, 3000),
      contentType: 'image/png',
    });
    const query = {
      ...queryOf(service.signedUrls(ready())?.thumbnailUrl ?? ''),
      format: 'webp' as const,
    };

    const [first, second] = await Promise.all([
      service.resolve(FILE_ID, 'thumbnail', query, undefined),
      service.resolve(FILE_ID, 'thumbnail', query, undefined),
    ]);
    const key = variantKeyOf(FILE_ID, 'thumbnail', 'webp');
    expect(first.url).toBe(`http://storage/${key}`);
    expect(second.url).toBe(first.url);
    // 並行的兩個請求只轉一次
    expect(storage.putObject).toHaveBeenCalledTimes(1);
    await expect(sharp(storage.objects.get(key)?.data).metadata()).resolves.toMatchObject({
      format: 'webp',
      width: 480,
    });

    await service.resolve(FILE_ID, 'thumbnail', query, undefined);
    expect(storage.putObject).toHaveBeenCalledTimes(1);
  });

  it('format=auto 協商出的格式還沒轉出：先轉址到主格式、只短暫快取，背景轉完後再來就拿到新格式（PERF-07）', async () => {
    const { service, storage } = setup(ready());
    storage.objects.set(storageKeyOf(FILE_ID), {
      data: await png(600, 400),
      contentType: 'image/png',
    });
    const query = {
      ...queryOf(service.signedUrls(ready())?.previewUrl ?? ''),
      format: 'auto' as const,
    };
    const accept = 'image/avif,image/webp,*/*';

    const first = await service.resolve(FILE_ID, 'preview', query, accept);
    expect(first.url).toBe(`http://storage/${variantKeyOf(FILE_ID, 'preview', 'jpeg')}`);
    expect(first.maxAge).toBeLessThanOrEqual(30);

    await service.whenIdle();
    const avif = variantKeyOf(FILE_ID, 'preview', 'avif');
    expect(storage.objects.get(avif)?.contentType).toBe('image/avif');
    const second = await service.resolve(FILE_ID, 'preview', query, accept);
    expect(second.url).toBe(`http://storage/${avif}`);
    expect(second.maxAge).toBeGreaterThan(30);
  });

  it('format=auto 的原圖是瀏覽器顯示不了的 TIFF：不退回原圖，等轉完', async () => {
    const tiff = () => fileRow({ ...ready(), contentType: 'image/tiff', name: 'scan.tiff' });
    const { service, storage } = setup(tiff());
    storage.objects.set(storageKeyOf(FILE_ID), {
      data: await sharp({ create: { width: 30, height: 20, channels: 3, background: '#000' } })
        .tiff()
        .toBuffer(),
      contentType: 'image/tiff',
    });
    const query = {
      ...queryOf(service.signedUrls(tiff())?.originalUrl ?? ''),
      format: 'auto' as const,
    };
    const result = await service.resolve(FILE_ID, 'original', query, 'image/webp,*/*');
    expect(result.url).toBe(`http://storage/${variantKeyOf(FILE_ID, 'original', 'webp')}`);
  });

  it('原圖也能要求 progressive JPEG', async () => {
    const { service, storage } = setup(ready());
    storage.objects.set(storageKeyOf(FILE_ID), {
      data: await png(600, 400),
      contentType: 'image/png',
    });
    const query = {
      ...queryOf(service.signedUrls(ready())?.originalUrl ?? ''),
      format: 'jpeg' as const,
    };
    await service.resolve(FILE_ID, 'original', query, undefined);
    const stored = storage.objects.get(variantKeyOf(FILE_ID, 'original', 'jpeg'));
    await expect(sharp(stored?.data).metadata()).resolves.toMatchObject({
      width: 600,
      isProgressive: true,
    });
  });

  it('簽章不符、換了版本、過期 → FILE_IMAGE_URL_INVALID', async () => {
    const { service } = setup(ready());
    const query = queryOf(service.signedUrls(ready())?.previewUrl ?? '');
    expect(
      await codeOf(service.resolve(FILE_ID, 'preview', { ...query, sig: 'x' }, undefined)),
    ).toBe('FILE_IMAGE_URL_INVALID');
    expect(await codeOf(service.resolve(FILE_ID, 'original', query, undefined))).toBe(
      'FILE_IMAGE_URL_INVALID',
    );
    expect(await codeOf(service.resolve(FILE_ID, 'preview', { ...query, exp: 1 }, undefined))).toBe(
      'FILE_IMAGE_URL_INVALID',
    );
  });

  it('檔案已刪除或變體不可用 → FILE_NOT_FOUND', async () => {
    const deleted = setup(undefined);
    const query = queryOf(deleted.service.signedUrls(ready())?.previewUrl ?? '');
    await expect(
      deleted.service.resolve(FILE_ID, 'preview', query, undefined),
    ).rejects.toMatchObject({
      code: 'FILE_NOT_FOUND',
    });
    const failed = setup(fileRow({ variantStatus: 'failed' }));
    await expect(
      failed.service.resolve(FILE_ID, 'preview', query, undefined),
    ).rejects.toMatchObject({
      code: 'FILE_NOT_FOUND',
    });
  });
});

describe('negotiateFormat', () => {
  const chrome = 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8';
  const legacy = 'image/png,image/*;q=0.8';

  it.each([
    [undefined, chrome, 'preview', 'jpeg'],
    [undefined, chrome, 'original', undefined],
    ['png', chrome, 'thumbnail', 'png'],
    ['auto', chrome, 'preview', 'avif'],
    ['auto', 'image/webp,*/*', 'preview', 'webp'],
    ['auto', legacy, 'preview', 'jpeg'],
    ['auto', undefined, 'thumbnail', 'jpeg'],
    // 原圖本身已是瀏覽器接受的格式 → 不重新編碼
    ['auto', legacy, 'original', undefined],
  ] as const)('format=%s Accept=%s variant=%s → %s', (requested, accept, variant, expected) => {
    expect(negotiateFormat(requested, accept, variant, 'jpeg', 'image/png')).toBe(expected);
  });
});
