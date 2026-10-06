import { Readable } from 'node:stream';

import { S3ServiceException } from '@aws-sdk/client-s3';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '../../config';
import type { Database } from '../../database';
import { runInTenantContext } from '../../tenant';
import type { TenantDirectory } from '../../tenant';
import { isValidBucketName } from '../object-storage';
import { S3ObjectStorage } from '../s3-object-storage';

interface SentCommand {
  constructor: { name: string };
  input: { Bucket?: string; Key?: string };
}

function notFound() {
  return new S3ServiceException({
    name: 'NotFound',
    $fault: 'client',
    $metadata: { httpStatusCode: 404 },
  });
}

function setup(existingBuckets: string[] = [], publicEndpoint = 'http://localhost:5173/storage') {
  const config = {
    get: vi.fn(
      (key: string) =>
        ({
          NODE_ENV: 'test',
          FILE_STORAGE_REGION: 'us-east-1',
          FILE_STORAGE_ACCESS_KEY_ID: 'key',
          FILE_STORAGE_SECRET_ACCESS_KEY: 'secret-key',
          FILE_STORAGE_ENDPOINT: 'http://127.0.0.1:9000/storage',
          FILE_STORAGE_PUBLIC_ENDPOINT: publicEndpoint,
          APP_PUBLIC_URL: 'https://example.com',
        })[key],
    ),
  } as unknown as ConfigService<Env, true>;
  // 租戶的主要網域：測試裡的租戶 id 就是網域的第一段（`acme` → `acme.example.com`）
  const directory = {
    requirePrimaryDomain: async (id: string) => `${id}.example.com`,
  } as unknown as TenantDirectory;
  const storage = new S3ObjectStorage(config, directory);
  const sent: SentCommand[] = [];
  const buckets = new Set(existingBuckets);
  const send = vi.fn(async (command: SentCommand) => {
    sent.push(command);
    const name = command.constructor.name;
    if (name === 'HeadBucketCommand' && !buckets.has(command.input.Bucket!)) throw notFound();
    if (name === 'CreateBucketCommand') buckets.add(command.input.Bucket!);
    if (name === 'HeadObjectCommand') throw notFound();
    return {};
  });
  (storage as unknown as { client: { send: typeof send } }).client = { send };
  return { storage, sent, buckets };
}

const inTenant = <T>(bucket: string, fn: () => T) =>
  runInTenantContext(
    {
      id: bucket,
      code: bucket,
      db: {} as Database,
      storageBucket: bucket,
      features: ['file', 'auditLog', 'job'],
      flags: {},
      featureParams: {},
    },
    fn,
  );

describe('S3ObjectStorage：每個租戶一個 bucket（docs/architecture/05-tenancy.md §10.2 D16）', () => {
  it('每個操作都用目前租戶的 bucket', async () => {
    const { storage, sent } = setup();
    await inTenant('b2b-acme', () => storage.head('files/1'));
    await inTenant('b2b-beta', () => storage.delete('files/1'));
    expect(sent.map((command) => command.input.Bucket)).toEqual(['b2b-acme', 'b2b-beta']);
  });

  it('列出物件（檔案維護的對帳）只看目前租戶的 bucket', async () => {
    const { storage, sent } = setup();
    await inTenant('b2b-acme', async () => {
      for await (const _ of storage.listObjects('files/')) void _;
    });
    expect(sent[0]?.input.Bucket).toBe('b2b-acme');
  });

  it('沒有租戶脈絡時拋 TENANT_NOT_FOUND，不會退回共用的 bucket', async () => {
    const { storage, sent } = setup();
    await expect(storage.head('files/1')).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
    expect(sent).toHaveLength(0);
  });

  it('ensureBucket 分別確認每個租戶的 bucket，不存在就建立', async () => {
    const { storage, buckets } = setup(['b2b-acme']);
    await inTenant('b2b-acme', () => storage.ensureBucket());
    await inTenant('b2b-beta', () => storage.ensureBucket());
    expect([...buckets].toSorted()).toEqual(['b2b-acme', 'b2b-beta']);
  });

  it('bucket 名稱要符合 S3 的命名規則', () => {
    expect(isValidBucketName('b2b-acme')).toBe(true);
    for (const name of ['B2B', 'ab', 'a..b', '-acme', 'acme_1']) {
      expect(isValidBucketName(name)).toBe(false);
    }
  });

  it('presigned URL 簽的是目前租戶的網域（`{tenantOrigin}`）：瀏覽器只能直傳到同源的 /storage', async () => {
    const { storage } = setup([], '{tenantOrigin}/storage');
    const acme = await inTenant('acme', () =>
      storage.presignDownload('a/b', { expiresIn: 60, disposition: 'inline', fileName: 'x.png' }),
    );
    const beta = await inTenant('beta', () =>
      storage.presignUpload('a/b', { expiresIn: 60, contentType: 'image/png' }),
    );
    expect(new URL(acme.url).origin).toBe('https://acme.example.com');
    expect(new URL(acme.url).pathname).toBe('/storage/acme/a/b');
    expect(new URL(beta.url).origin).toBe('https://beta.example.com');
  });

  it('固定的公開網址（真正的 S3、CDN）→ 不依租戶改變', async () => {
    const { storage } = setup([], 'https://s3.example.net');
    const signed = await inTenant('acme', () =>
      storage.presignUpload('k', { expiresIn: 60, contentType: 'text/plain' }),
    );
    expect(new URL(signed.url).origin).toBe('https://s3.example.net');
  });

  it('presignDownload 帶 contentType 時簽進 response-content-type', async () => {
    const { storage } = setup();
    const signed = await inTenant('acme', () =>
      storage.presignDownload('files/1', {
        expiresIn: 60,
        disposition: 'attachment',
        fileName: 'index.html',
        contentType: 'application/octet-stream',
      }),
    );
    const params = new URL(signed.url).searchParams;
    expect(params.get('response-content-type')).toBe('application/octet-stream');
    expect(params.get('response-content-disposition')).toMatch(/^attachment;/);
  });
});

// ── 各操作的回應對應與錯誤分類（docs/architecture/backend/09-file.md §2、§5.2） ──

interface Command {
  constructor: { name: string };
  input: Record<string, unknown>;
}

type Handler = (input: Record<string, unknown>) => unknown;

/** S3 的服務端錯誤（`name` 是 S3 的錯誤碼）。 */
function s3Error(name: string, httpStatusCode = 400): S3ServiceException {
  return new S3ServiceException({ name, $fault: 'client', $metadata: { httpStatusCode } });
}

/**
 * 依指令名稱回應的假 S3 client。`handlers` 回傳值或拋錯；沒列到的指令回 `{}`。
 * `NODE_ENV` 預設 test（啟動時不碰儲存服務）。
 */
function storageWith(
  handlers: Record<string, Handler> = {},
  options: { nodeEnv?: string; activeBuckets?: string[] } = {},
) {
  const config = {
    get: (key: string) =>
      ({
        NODE_ENV: options.nodeEnv ?? 'test',
        FILE_STORAGE_REGION: 'us-east-1',
        FILE_STORAGE_ACCESS_KEY_ID: 'key',
        FILE_STORAGE_SECRET_ACCESS_KEY: 'secret-key',
        FILE_STORAGE_ENDPOINT: 'http://127.0.0.1:9000/storage',
        FILE_STORAGE_PUBLIC_ENDPOINT: 'http://localhost:5173/storage',
        APP_PUBLIC_URL: 'https://example.com',
      })[key],
  } as unknown as ConfigService<Env, true>;
  const directory = {
    requirePrimaryDomain: async (id: string) => `${id}.example.com`,
    listActive: vi.fn(async () =>
      (options.activeBuckets ?? []).map((storageBucket) => ({ storageBucket })),
    ),
  };
  const storage = new S3ObjectStorage(config, directory as unknown as TenantDirectory);
  const commands: Command[] = [];
  const send = vi.fn(async (command: Command) => {
    commands.push(command);
    const handler = handlers[command.constructor.name];
    return handler ? handler(command.input) : {};
  });
  const destroy = vi.fn();
  (storage as unknown as { client: unknown }).client = { send, destroy };
  /** 某個指令收到的 input。 */
  const inputsOf = (name: string) =>
    commands.filter((command) => command.constructor.name === name).map(({ input }) => input);
  return { storage, commands, inputsOf, send, destroy, directory };
}

const inAcme = <T>(fn: () => T) => inTenant('b2b-acme', fn);

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

const throwing =
  (error: unknown): Handler =>
  () => {
    throw error;
  };

describe('S3ObjectStorage：讀寫與錯誤分類', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('head：回傳大小、去掉引號的 ETag 與型別', async () => {
    const { storage } = storageWith({
      HeadObjectCommand: () => ({ ContentLength: 12, ETag: '"abc"', ContentType: 'image/png' }),
    });
    await expect(inAcme(() => storage.head('k'))).resolves.toEqual({
      size: 12,
      etag: 'abc',
      contentType: 'image/png',
    });
  });

  it('head：S3 沒回大小與 ETag 時以 0 與空字串代替', async () => {
    const { storage } = storageWith({ HeadObjectCommand: () => ({}) });
    await expect(inAcme(() => storage.head('k'))).resolves.toEqual({
      size: 0,
      etag: '',
      contentType: undefined,
    });
  });

  it.each([
    ['HTTP 404', s3Error('Unknown', 404)],
    ['NotFound', s3Error('NotFound')],
    ['NoSuchKey', s3Error('NoSuchKey')],
    ['NoSuchBucket', s3Error('NoSuchBucket')],
  ])('物件不存在（%s）：head 回 undefined', async (_name, error) => {
    const { storage } = storageWith({ HeadObjectCommand: throwing(error) });
    await expect(inAcme(() => storage.head('k'))).resolves.toBeUndefined();
  });

  it.each([
    ['S3 的其他錯誤', s3Error('AccessDenied', 403)],
    [
      '連線失敗（不是 S3 的錯誤，即使名稱像 NotFound）',
      Object.assign(new Error('x'), { name: 'NotFound' }),
    ],
  ])('head 遇到 %s → FILE_STORAGE_UNAVAILABLE', async (_name, error) => {
    const { storage } = storageWith({ HeadObjectCommand: throwing(error) });
    await expect(inAcme(() => storage.head('k'))).rejects.toMatchObject({
      code: 'FILE_STORAGE_UNAVAILABLE',
    });
  });

  it('儲存服務故障時記錄操作與 bucket', async () => {
    const { storage } = storageWith({ HeadObjectCommand: throwing(new Error('ECONNREFUSED')) });
    await inAcme(() => storage.head('k')).catch(() => {});
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'head', bucket: 'b2b-acme' }),
      expect.any(String),
    );
  });

  it('delete：物件不存在視為成功', async () => {
    const { storage } = storageWith({ DeleteObjectCommand: throwing(s3Error('NoSuchKey')) });
    await expect(inAcme(() => storage.delete('k'))).resolves.toBeUndefined();
  });

  it('delete：其他失敗 → FILE_STORAGE_UNAVAILABLE', async () => {
    const { storage } = storageWith({ DeleteObjectCommand: throwing(new Error('timeout')) });
    await expect(inAcme(() => storage.delete('k'))).rejects.toMatchObject({
      code: 'FILE_STORAGE_UNAVAILABLE',
    });
  });

  it('getObject：回傳內容串流；不存在回 undefined；其他失敗 → FILE_STORAGE_UNAVAILABLE', async () => {
    const body = Readable.from(['data']);
    const ok = storageWith({ GetObjectCommand: () => ({ Body: body }) });
    await expect(inAcme(() => ok.storage.getObject('k'))).resolves.toBe(body);

    const missing = storageWith({ GetObjectCommand: throwing(s3Error('NoSuchKey', 404)) });
    await expect(inAcme(() => missing.storage.getObject('k'))).resolves.toBeUndefined();

    const broken = storageWith({ GetObjectCommand: throwing(new Error('reset')) });
    await expect(inAcme(() => broken.storage.getObject('k'))).rejects.toMatchObject({
      code: 'FILE_STORAGE_UNAVAILABLE',
    });
  });

  it('putObject：寫到目前租戶的 bucket 並帶上型別', async () => {
    const { storage, inputsOf } = storageWith();
    const body = Buffer.from('x');
    await inAcme(() => storage.putObject('v/1', body, { contentType: 'image/webp' }));
    expect(inputsOf('PutObjectCommand')).toEqual([
      { Bucket: 'b2b-acme', Key: 'v/1', Body: body, ContentType: 'image/webp' },
    ]);
  });

  it('putObject：失敗 → FILE_STORAGE_UNAVAILABLE（不區分 404）', async () => {
    const { storage } = storageWith({ PutObjectCommand: throwing(s3Error('NoSuchBucket', 404)) });
    await expect(
      inAcme(() => storage.putObject('k', Buffer.from('x'), { contentType: 'text/plain' })),
    ).rejects.toMatchObject({ code: 'FILE_STORAGE_UNAVAILABLE' });
  });

  it('listObjects：依 continuation token 逐頁列出，略過沒有 key 的項目並補預設值', async () => {
    const modified = new Date('2026-10-01T00:00:00Z');
    const { storage, inputsOf } = storageWith({
      ListObjectsV2Command: (input) =>
        input.ContinuationToken === undefined
          ? {
              Contents: [{ Key: 'a', Size: 1, LastModified: modified }, { Size: 9 }],
              IsTruncated: true,
              NextContinuationToken: 'page-2',
            }
          : { Contents: [{ Key: 'b' }], IsTruncated: false },
    });
    await expect(inAcme(() => collect(storage.listObjects('files/')))).resolves.toEqual([
      { key: 'a', size: 1, lastModified: modified },
      { key: 'b', size: 0, lastModified: new Date(0) },
    ]);
    expect(
      inputsOf('ListObjectsV2Command').map(({ Prefix, ContinuationToken }) => ({
        Prefix,
        ContinuationToken,
      })),
    ).toEqual([
      { Prefix: 'files/', ContinuationToken: undefined },
      { Prefix: 'files/', ContinuationToken: 'page-2' },
    ]);
  });

  it('listObjects：空的 bucket 不產生任何項目', async () => {
    const { storage } = storageWith({ ListObjectsV2Command: () => ({}) });
    await expect(inAcme(() => collect(storage.listObjects('x/')))).resolves.toEqual([]);
  });

  it('listObjects：失敗 → FILE_STORAGE_UNAVAILABLE', async () => {
    const { storage } = storageWith({ ListObjectsV2Command: throwing(new Error('x')) });
    await expect(inAcme(() => collect(storage.listObjects('x/')))).rejects.toMatchObject({
      code: 'FILE_STORAGE_UNAVAILABLE',
    });
  });

  it('ping：ListBuckets 成功 → true；失敗 → false', async () => {
    await expect(storageWith().storage.ping()).resolves.toBe(true);
    await expect(
      storageWith({ ListBucketsCommand: throwing(new Error('down')) }).storage.ping(),
    ).resolves.toBe(false);
  });
});

describe('S3ObjectStorage：presigned URL', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('presignUpload：PUT、要原樣帶上 Content-Type（已簽進去）、到期時間是現在 ＋ expiresIn', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-01T00:00:00Z') });
    const { storage } = storageWith();
    const signed = await inAcme(() =>
      storage.presignUpload('files/1', { contentType: 'image/png', expiresIn: 300 }),
    );
    expect(signed).toMatchObject({
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      expiresAt: new Date('2026-10-01T00:05:00Z'),
    });
    const params = new URL(signed.url).searchParams;
    expect(params.get('X-Amz-SignedHeaders')?.split(';')).toContain('content-type');
    expect(params.get('X-Amz-Expires')).toBe('300');
  });

  it('presignDownload：同一個時間窗內網址不變，快取時間是效期的一半', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-01T00:00:10Z') });
    const { storage } = storageWith();
    const options = { expiresIn: 600, disposition: 'inline' as const, fileName: 'a.png' };
    const first = await inAcme(() => storage.presignDownload('files/1', options));
    vi.setSystemTime(new Date('2026-10-01T00:04:00Z'));
    const second = await inAcme(() => storage.presignDownload('files/1', options));

    expect(second.url).toBe(first.url);
    expect(first).toMatchObject({ method: 'GET', headers: {} });
    // 簽章時間取整到 00:00:00，所以到期是 00:10:00
    expect(first.expiresAt).toEqual(new Date('2026-10-01T00:10:00Z'));
    expect(new URL(first.url).searchParams.get('response-cache-control')).toBe(
      'private, max-age=300, immutable',
    );
  });

  it('presignDownload：跨過時間窗後網址改變', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-01T00:00:10Z') });
    const { storage } = storageWith();
    const options = { expiresIn: 600, disposition: 'inline' as const, fileName: 'a.png' };
    const first = await inAcme(() => storage.presignDownload('files/1', options));
    vi.setSystemTime(new Date('2026-10-01T00:05:00Z'));
    const second = await inAcme(() => storage.presignDownload('files/1', options));
    expect(second.url).not.toBe(first.url);
  });

  it('presignDownload：沒給 contentType 時不覆寫回應的型別', async () => {
    const { storage } = storageWith();
    const signed = await inAcme(() =>
      storage.presignDownload('files/1', { expiresIn: 60, disposition: 'inline', fileName: 'a' }),
    );
    expect(new URL(signed.url).searchParams.has('response-content-type')).toBe(false);
  });

  it('presignUploadPart：PUT 到指定 uploadId 的第 N 塊', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-01T00:00:00Z') });
    const { storage } = storageWith();
    const signed = await inAcme(() =>
      storage.presignUploadPart('files/1', 'up-1', 3, { expiresIn: 60 }),
    );
    const url = new URL(signed.url);
    expect(url.searchParams.get('uploadId')).toBe('up-1');
    expect(url.searchParams.get('partNumber')).toBe('3');
    expect(signed).toMatchObject({
      method: 'PUT',
      headers: {},
      expiresAt: new Date('2026-10-01T00:01:00Z'),
    });
  });

  it('沒有租戶脈絡時 presign 也拋 TENANT_NOT_FOUND', async () => {
    const { storage } = storageWith();
    await expect(
      storage.presignUpload('k', { contentType: 'text/plain', expiresIn: 60 }),
    ).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });
});

describe('S3ObjectStorage：分塊上傳（docs/architecture/backend/09-file.md §5.2）', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('createMultipartUpload：回傳 uploadId，型別在這一步決定', async () => {
    const { storage, inputsOf } = storageWith({
      CreateMultipartUploadCommand: () => ({ UploadId: 'up-1' }),
    });
    await expect(
      inAcme(() => storage.createMultipartUpload('files/1', { contentType: 'video/mp4' })),
    ).resolves.toBe('up-1');
    expect(inputsOf('CreateMultipartUploadCommand')).toEqual([
      { Bucket: 'b2b-acme', Key: 'files/1', ContentType: 'video/mp4' },
    ]);
  });

  it.each([
    ['S3 沒回 UploadId', () => ({})],
    ['S3 失敗', throwing(new Error('x'))],
  ])('createMultipartUpload：%s → FILE_STORAGE_UNAVAILABLE', async (_name, handler) => {
    const { storage } = storageWith({ CreateMultipartUploadCommand: handler });
    await expect(
      inAcme(() => storage.createMultipartUpload('k', { contentType: 'video/mp4' })),
    ).rejects.toMatchObject({ code: 'FILE_STORAGE_UNAVAILABLE' });
  });

  it('completeMultipartUpload：ETag 一律帶雙引號送出（傳入有無引號皆可）', async () => {
    const { storage, inputsOf } = storageWith();
    await inAcme(() =>
      storage.completeMultipartUpload('files/1', 'up-1', [
        { partNumber: 1, etag: 'aaa' },
        { partNumber: 2, etag: '"bbb"' },
      ]),
    );
    expect(inputsOf('CompleteMultipartUploadCommand')[0]).toMatchObject({
      UploadId: 'up-1',
      MultipartUpload: {
        Parts: [
          { PartNumber: 1, ETag: '"aaa"' },
          { PartNumber: 2, ETag: '"bbb"' },
        ],
      },
    });
  });

  it.each(['InvalidPart', 'InvalidPartOrder', 'EntityTooSmall', 'NoSuchUpload'])(
    'completeMultipartUpload：客戶端交來的塊不對（%s）→ FILE_UPLOAD_INCOMPLETE',
    async (name) => {
      const { storage } = storageWith({ CompleteMultipartUploadCommand: throwing(s3Error(name)) });
      await expect(
        inAcme(() => storage.completeMultipartUpload('k', 'up', [{ partNumber: 1, etag: 'a' }])),
      ).rejects.toMatchObject({ code: 'FILE_UPLOAD_INCOMPLETE' });
    },
  );

  it.each([
    ['S3 的其他錯誤', s3Error('InternalError', 500)],
    ['名稱相同但不是 S3 的錯誤', Object.assign(new Error('x'), { name: 'InvalidPart' })],
  ])('completeMultipartUpload：%s → FILE_STORAGE_UNAVAILABLE', async (_name, error) => {
    const { storage } = storageWith({ CompleteMultipartUploadCommand: throwing(error) });
    await expect(
      inAcme(() => storage.completeMultipartUpload('k', 'up', [{ partNumber: 1, etag: 'a' }])),
    ).rejects.toMatchObject({ code: 'FILE_STORAGE_UNAVAILABLE' });
  });

  it('abortMultipartUpload：uploadId 不存在視為成功；其他失敗 → FILE_STORAGE_UNAVAILABLE', async () => {
    const missing = storageWith({
      AbortMultipartUploadCommand: throwing(s3Error('NoSuchUpload', 404)),
    });
    await expect(
      inAcme(() => missing.storage.abortMultipartUpload('k', 'up')),
    ).resolves.toBeUndefined();

    const broken = storageWith({ AbortMultipartUploadCommand: throwing(new Error('x')) });
    await expect(
      inAcme(() => broken.storage.abortMultipartUpload('k', 'up')),
    ).rejects.toMatchObject({
      code: 'FILE_STORAGE_UNAVAILABLE',
    });
  });

  it('listMultipartUploads：依 key／uploadId marker 逐頁列出，略過不完整的項目', async () => {
    const initiated = new Date('2026-10-01T00:00:00Z');
    const { storage, inputsOf } = storageWith({
      ListMultipartUploadsCommand: (input) =>
        input.KeyMarker === undefined
          ? {
              Uploads: [
                { Key: 'a', UploadId: 'u1', Initiated: initiated },
                { Key: 'no-upload-id' },
                { UploadId: 'no-key' },
              ],
              IsTruncated: true,
              NextKeyMarker: 'a',
              NextUploadIdMarker: 'u1',
            }
          : { Uploads: [{ Key: 'b', UploadId: 'u2' }], IsTruncated: false },
    });
    await expect(inAcme(() => collect(storage.listMultipartUploads('files/')))).resolves.toEqual([
      { key: 'a', uploadId: 'u1', initiatedAt: initiated },
      { key: 'b', uploadId: 'u2', initiatedAt: new Date(0) },
    ]);
    expect(
      inputsOf('ListMultipartUploadsCommand').map(({ KeyMarker, UploadIdMarker }) => ({
        KeyMarker,
        UploadIdMarker,
      })),
    ).toEqual([
      { KeyMarker: undefined, UploadIdMarker: undefined },
      { KeyMarker: 'a', UploadIdMarker: 'u1' },
    ]);
  });

  it('listMultipartUploads：沒有被截斷時即使帶著 marker 也不再查下一頁', async () => {
    const { storage, send } = storageWith({
      ListMultipartUploadsCommand: () => ({ IsTruncated: false, NextKeyMarker: 'z' }),
    });
    await inAcme(() => collect(storage.listMultipartUploads('x/')));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('listMultipartUploads：失敗 → FILE_STORAGE_UNAVAILABLE', async () => {
    const { storage } = storageWith({ ListMultipartUploadsCommand: throwing(new Error('x')) });
    await expect(inAcme(() => collect(storage.listMultipartUploads('x/')))).rejects.toMatchObject({
      code: 'FILE_STORAGE_UNAVAILABLE',
    });
  });
});

describe('S3ObjectStorage：bucket 的確認與建立', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('bucket 已存在：不建立', async () => {
    const { storage, inputsOf } = storageWith();
    await inAcme(() => storage.ensureBucket());
    expect(inputsOf('CreateBucketCommand')).toEqual([]);
  });

  it('同一個 bucket 只確認一次（含同時呼叫）', async () => {
    const { storage, inputsOf } = storageWith();
    await inAcme(() => Promise.all([storage.ensureBucket(), storage.ensureBucket()]));
    await inAcme(() => storage.ensureBucket());
    expect(inputsOf('HeadBucketCommand')).toHaveLength(1);
  });

  it('確認失敗（不是不存在）→ FILE_STORAGE_UNAVAILABLE，下一次會重試', async () => {
    let fail = true;
    const { storage, inputsOf } = storageWith({
      HeadBucketCommand: () => {
        if (fail) throw s3Error('AccessDenied', 403);
        return {};
      },
    });
    await expect(inAcme(() => storage.ensureBucket())).rejects.toMatchObject({
      code: 'FILE_STORAGE_UNAVAILABLE',
    });
    fail = false;
    await expect(inAcme(() => storage.ensureBucket())).resolves.toBeUndefined();
    expect(inputsOf('HeadBucketCommand')).toHaveLength(2);
  });

  it('另一個執行個體剛好同時建立（BucketAlreadyOwnedByYou）→ 視為成功', async () => {
    const { storage } = storageWith({
      HeadBucketCommand: throwing(s3Error('NotFound', 404)),
      CreateBucketCommand: throwing(s3Error('BucketAlreadyOwnedByYou', 409)),
    });
    await expect(inAcme(() => storage.ensureBucket())).resolves.toBeUndefined();
  });

  it('建立失敗（其他錯誤）→ FILE_STORAGE_UNAVAILABLE', async () => {
    const { storage } = storageWith({
      HeadBucketCommand: throwing(s3Error('NotFound', 404)),
      CreateBucketCommand: throwing(s3Error('BucketAlreadyExists', 409)),
    });
    await expect(inAcme(() => storage.ensureBucket())).rejects.toMatchObject({
      code: 'FILE_STORAGE_UNAVAILABLE',
    });
  });

  it('啟動時（非 test 環境）確認每個 active 租戶的 bucket', async () => {
    const { storage, inputsOf } = storageWith(
      { HeadBucketCommand: throwing(s3Error('NotFound', 404)) },
      { nodeEnv: 'production', activeBuckets: ['b2b-acme', 'b2b-beta'] },
    );
    storage.onApplicationBootstrap();
    await vi.waitFor(() => expect(inputsOf('CreateBucketCommand')).toHaveLength(2));
    expect(
      inputsOf('CreateBucketCommand')
        .map(({ Bucket }) => Bucket)
        .toSorted(),
    ).toEqual(['b2b-acme', 'b2b-beta']);
  });

  it('啟動時連不上儲存服務：只記 warn，不讓啟動失敗', async () => {
    const { storage } = storageWith(
      { HeadBucketCommand: throwing(new Error('ECONNREFUSED')) },
      { nodeEnv: 'production', activeBuckets: ['b2b-acme'] },
    );
    expect(() => storage.onApplicationBootstrap()).not.toThrow();
    await vi.waitFor(() => expect(Logger.prototype.warn).toHaveBeenCalled());
  });

  it('test 環境啟動時不碰儲存服務', () => {
    const { storage, send, directory } = storageWith({}, { activeBuckets: ['b2b-acme'] });
    storage.onApplicationBootstrap();
    expect(directory.listActive).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('程序關閉時釋放 client', () => {
    const { storage, destroy } = storageWith();
    storage.onApplicationShutdown();
    expect(destroy).toHaveBeenCalled();
  });
});
