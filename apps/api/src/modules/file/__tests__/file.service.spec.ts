import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import type { Env } from '@/core/config';
import type { Database } from '@/core/database';
import { AppException } from '@/core/errors';
import type { DomainEventBus } from '@/core/events';
import type { SettingService } from '@/core/settings';
import type { ObjectStorage, StoredObjectHead } from '@/core/storage';
import type { AuditService } from '@/modules/audit-log/audit.service';

import type { FileFolderService } from '../file-folder.service';
import type { FileImageService } from '../file-image.service';
import { FileObjectsService } from '../file-objects.service';
import { storageKeyOf, thumbnailKeyOf, variantKeyOf, variantPrefixOf } from '../file.constants';
import { decodeFileCursor, encodeFileCursor } from '../file.cursor';
import type { FileRepository, FileWithUploader } from '../file.repository';
import { FileService } from '../file.service';
import { createFileAccess } from './file-access.fixture';
import type { AccessFixtureOptions } from './file-access.fixture';

const ALICE: AuthUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'a@x',
  status: 'active',
};
const BOB: AuthUser = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'b@x',
  status: 'active',
};
const FILE_ID = '33333333-3333-4333-8333-333333333333';
const MAX_SIZE = 100 * 1024 * 1024;
const THRESHOLD = 16 * 1024 * 1024;
const PART_SIZE = 8 * 1024 * 1024;

function fileRow(overrides: Partial<FileWithUploader> = {}): FileWithUploader {
  const now = new Date('2026-09-27T00:00:00Z');
  return {
    id: FILE_ID,
    name: 'hero.png',
    contentType: 'image/png',
    size: 10,
    storageKey: storageKeyOf(FILE_ID),
    etag: null,
    status: 'pending',
    uploadedAt: null,
    uploadId: null,
    hasThumbnail: false,
    version: 1,
    variantStatus: 'none',
    imageWidth: null,
    imageHeight: null,
    variantFormat: null,
    folderId: null,
    createdAt: now,
    createdBy: ALICE.id,
    updatedAt: now,
    updatedBy: ALICE.id,
    deletedAt: null,
    deletionId: null,
    uploader: { id: ALICE.id, displayName: 'Alice' },
    ...overrides,
  };
}

function setup(
  options: {
    file?: FileWithUploader;
    /** 已刪除的列（還原）。 */
    deleted?: FileWithUploader;
    head?: StoredObjectHead;
    thumbnailHead?: StoredObjectHead;
    access?: AccessFixtureOptions;
  } = {},
) {
  const repo = {
    findById: vi.fn(async () => options.file),
    create: vi.fn(async (values: Partial<FileWithUploader>) => fileRow(values)),
    markReady: vi.fn(async () => fileRow({ status: 'ready' })),
    update: vi.fn(async () => fileRow({ status: 'ready' })),
    findVersion: vi.fn(async (): Promise<number | undefined> => 4),
    softDelete: vi.fn(async () => fileRow({ status: 'ready' })),
    discardPending: vi.fn(async () => fileRow({ deletedAt: new Date() })),
    list: vi.fn(),
    findDeletedById: vi.fn(async () => options.deleted),
    restore: vi.fn(async () => (options.deleted ? [options.deleted] : [])),
    clearThumbnail: vi.fn(async () => undefined),
    resetVariants: vi.fn(async () => undefined),
  };
  const storage = {
    ensureBucket: vi.fn(async () => undefined),
    head: vi.fn(async (key: string) =>
      key.startsWith('thumbnails/') ? options.thumbnailHead : options.head,
    ),
    delete: vi.fn(async () => undefined),
    listObjects: vi.fn((prefix: string) =>
      (async function* () {
        yield { key: `${prefix}preview.jpeg`, size: 1, lastModified: new Date() };
      })(),
    ),
    presignUpload: vi.fn(async (key: string) => ({
      url: `http://storage/${key}?put`,
      method: 'PUT' as const,
      headers: { 'Content-Type': 'image/png' },
      expiresAt: new Date('2026-09-27T00:15:00Z'),
    })),
    presignDownload: vi.fn(
      async (key: string, opts: { disposition: string; contentType?: string }) => ({
        url: `http://storage/${key}?${opts.disposition}${opts.contentType ? `&type=${opts.contentType}` : ''}`,
        method: 'GET' as const,
        headers: {},
        expiresAt: new Date('2026-09-27T00:15:00Z'),
      }),
    ),
    createMultipartUpload: vi.fn(async () => 'upload-1'),
    presignUploadPart: vi.fn(async (key: string, uploadId: string, partNumber: number) => ({
      url: `http://storage/${key}?uploadId=${uploadId}&partNumber=${partNumber}`,
      method: 'PUT' as const,
      headers: {},
      expiresAt: new Date('2026-09-27T00:15:00Z'),
    })),
    completeMultipartUpload: vi.fn(async () => undefined),
    abortMultipartUpload: vi.fn(async () => undefined),
  };
  const audit = { record: vi.fn(async () => undefined) };
  const events = { publish: vi.fn() };
  const images = {
    schedule: vi.fn(),
    deleteVariants: vi.fn(async () => undefined),
    signedUrls: vi.fn((file: FileWithUploader) =>
      file.status === 'ready' && file.variantStatus === 'ready'
        ? {
            width: 800,
            height: 600,
            originalUrl: `/api/files/${file.id}/image/original?sig`,
            previewUrl: `/api/files/${file.id}/image/preview?sig`,
            thumbnailUrl: `/api/files/${file.id}/image/thumbnail?sig`,
            expiresAt: '2026-09-27T00:10:00.000Z',
          }
        : null,
    ),
  };
  // withTransaction(db, fn) 只呼叫 db.transaction(fn)
  const db = { transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn('tx')) };
  // 根目錄不排隊，直接以預設連線執行
  const folders = {
    insideFolder: vi.fn(async (_folderId: unknown, work: (tx: unknown) => unknown) =>
      work(undefined),
    ),
    withinLiveFolder: vi.fn(
      async (_folderId: unknown, _missing: unknown, work: (tx: unknown) => unknown) => work('tx'),
    ),
  };
  const config = {
    get: vi.fn(
      (key: keyof Env) =>
        ({
          FILE_UPLOAD_MAX_SIZE: MAX_SIZE,
          FILE_URL_TTL: 900,
          FILE_MULTIPART_THRESHOLD: THRESHOLD,
          FILE_MULTIPART_PART_SIZE: PART_SIZE,
        })[key as string],
    ),
  };
  const service = new FileService(
    db as unknown as Database,
    repo as unknown as FileRepository,
    storage as unknown as ObjectStorage,
    audit as unknown as AuditService,
    events as unknown as DomainEventBus,
    images as unknown as FileImageService,
    folders as unknown as FileFolderService,
    createFileAccess(options.access).access,
    // 租戶沒有覆寫上限：生效值等於 env 的上限
    { get: vi.fn(async () => MAX_SIZE) } as unknown as SettingService,
    new FileObjectsService(storage as unknown as ObjectStorage),
    config as unknown as ConfigService<Env, true>,
  );
  return { service, repo, storage, audit, events, images, folders };
}

async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AppException);
  expect((error as AppException).code).toBe(code);
  return error as AppException;
}

describe('FileService.createUpload（docs/architecture/backend/09-file.md §4）', () => {
  it('登記 pending 紀錄、storage key 只由 id 決定，回傳直傳網址', async () => {
    const { service, repo, storage } = setup();
    const result = await service.createUpload(
      { name: '../../角色 1.png', contentType: 'image/png', size: 10 },
      ALICE,
    );

    const created = repo.create.mock.calls[0]?.[0];
    expect(created).toMatchObject({ status: 'pending', createdBy: ALICE.id, size: 10 });
    expect(created?.storageKey).toBe(storageKeyOf(created?.id ?? ''));
    expect(storage.ensureBucket).toHaveBeenCalled();
    expect(result.upload).toMatchObject({
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
    });
    expect(result.file).toMatchObject({ status: 'pending', url: null, downloadUrl: null });
  });

  it('超過大小上限回 FILE_TOO_LARGE，不建立紀錄', async () => {
    const { service, repo } = setup();
    await expectAppError(
      service.createUpload(
        { name: 'big.bin', contentType: 'application/octet-stream', size: MAX_SIZE + 1 },
        ALICE,
      ),
      'FILE_TOO_LARGE',
    );
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe('FileService.completeUpload', () => {
  it('物件存在且大小相符 → ready、寫稽核、發事件（帶所在的資料夾）', async () => {
    const { service, repo, audit, events } = setup({
      file: fileRow({ name: 'a.pdf', contentType: 'application/pdf' }),
      head: { size: 10, etag: 'abc', contentType: 'application/pdf' },
    });
    await service.completeUpload(FILE_ID, {}, ALICE);

    expect(repo.markReady).toHaveBeenCalledWith(
      FILE_ID,
      expect.objectContaining({ size: 10, etag: 'abc', updatedBy: ALICE.id }),
      'tx',
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'file.upload', resourceId: FILE_ID }),
      'tx',
    );
    expect(events.publish).toHaveBeenCalledWith('resource.changed', {
      changes: [{ resource: 'file', kind: 'create', id: FILE_ID, refs: { fileFolder: ['root'] } }],
    });
  });

  it('推播的 refs.fileFolder 是檔案所在的資料夾：前端只重抓正在看那個資料夾的列表', async () => {
    const folderId = '44444444-4444-4444-8444-444444444444';
    const { service, events } = setup({
      file: fileRow({ name: 'a.txt', contentType: 'text/plain', folderId }),
      head: { size: 10, etag: 'abc', contentType: 'text/plain' },
      access: {
        nodes: () => [{ id: folderId, parentId: null, inheritGrants: true, createdBy: null }],
      },
    });
    await service.completeUpload(FILE_ID, {}, ALICE);
    expect(events.publish).toHaveBeenCalledWith('resource.changed', {
      changes: [
        { resource: 'file', kind: 'create', id: FILE_ID, refs: { fileFolder: [folderId] } },
      ],
    });
  });

  it('物件還不存在 → FILE_UPLOAD_INCOMPLETE', async () => {
    const { service } = setup({ file: fileRow() });
    await expectAppError(service.completeUpload(FILE_ID, {}, ALICE), 'FILE_UPLOAD_INCOMPLETE');
  });

  it('大小不符 → 刪掉物件並回 FILE_SIZE_MISMATCH', async () => {
    const { service, storage, repo } = setup({
      file: fileRow(),
      head: { size: 999, etag: 'abc', contentType: 'image/png' },
    });
    await expectAppError(service.completeUpload(FILE_ID, {}, ALICE), 'FILE_SIZE_MISMATCH');
    expect(storage.delete).toHaveBeenCalledWith(storageKeyOf(FILE_ID));
    expect(repo.markReady).not.toHaveBeenCalled();
  });

  it('已經 ready → FILE_ALREADY_UPLOADED', async () => {
    const { service } = setup({
      file: fileRow({ status: 'ready', etag: 'abc', uploadedAt: new Date() }),
    });
    await expectAppError(service.completeUpload(FILE_ID, {}, ALICE), 'FILE_ALREADY_UPLOADED');
  });

  it('並行完成時第二個請求 → FILE_ALREADY_UPLOADED', async () => {
    const { service, repo } = setup({
      file: fileRow(),
      head: { size: 10, etag: 'abc', contentType: 'image/png' },
    });
    repo.markReady.mockResolvedValueOnce(undefined as never);
    await expectAppError(service.completeUpload(FILE_ID, {}, ALICE), 'FILE_ALREADY_UPLOADED');
  });

  it('別人的 pending 上傳視為不存在 → FILE_NOT_FOUND', async () => {
    const { service } = setup({ file: fileRow() });
    await expectAppError(service.completeUpload(FILE_ID, {}, BOB), 'FILE_NOT_FOUND');
  });
});

describe('FileService.findOne', () => {
  it('ready 的檔案帶 inline 與 attachment 兩個網址', async () => {
    const { service } = setup({
      file: fileRow({ status: 'ready', etag: 'abc', uploadedAt: new Date() }),
    });
    const file = await service.findOne(FILE_ID, BOB);
    expect(file.url).toContain('inline');
    expect(file.downloadUrl).toContain('attachment');
    expect(file.urlExpiresAt).toBe('2026-09-27T00:15:00.000Z');
  });

  it.each([
    ['text/html', 'index.html'],
    ['application/javascript', 'a.js'],
    ['application/xhtml+xml', 'a.xhtml'],
    ['application/pdf', 'a.pdf'],
  ])('%s 不 inline：url 也是 attachment、回應型別改成 octet-stream', async (contentType, name) => {
    const { service } = setup({
      file: fileRow({ name, contentType, status: 'ready', etag: 'abc', uploadedAt: new Date() }),
    });
    const file = await service.findOne(FILE_ID, BOB);
    expect(file.url).toContain('attachment&type=application/octet-stream');
    expect(file.downloadUrl).toContain('attachment&type=application/octet-stream');
  });

  it('SVG 保留型別（<img> 才畫得出來）但一律 attachment', async () => {
    const { service } = setup({
      file: fileRow({
        name: 'a.svg',
        contentType: 'image/svg+xml',
        status: 'ready',
        etag: 'abc',
        uploadedAt: new Date(),
      }),
    });
    const file = await service.findOne(FILE_ID, BOB);
    expect(file.url).toBe(`http://storage/${storageKeyOf(FILE_ID)}?attachment`);
  });

  it.each(['image/png', 'text/plain', 'video/mp4', 'audio/mpeg'])(
    '白名單型別 %s 維持 inline，不覆寫回應型別',
    async (contentType) => {
      const { service } = setup({
        file: fileRow({ contentType, status: 'ready', etag: 'abc', uploadedAt: new Date() }),
      });
      const file = await service.findOne(FILE_ID, BOB);
      expect(file.url).toBe(`http://storage/${storageKeyOf(FILE_ID)}?inline`);
    },
  );

  it('pending 只有上傳者看得到', async () => {
    const { service } = setup({ file: fileRow() });
    await expect(service.findOne(FILE_ID, ALICE)).resolves.toMatchObject({ status: 'pending' });
    await expectAppError(service.findOne(FILE_ID, BOB), 'FILE_NOT_FOUND');
  });
});

describe('FileService.update / remove', () => {
  const ready = () => fileRow({ status: 'ready', etag: 'abc', uploadedAt: new Date() });

  it('改名只記有變的欄位；名稱沒變時不寫入', async () => {
    const { service, repo, audit } = setup({ file: ready() });
    await service.update(FILE_ID, { name: 'hero.png' }, ALICE);
    expect(repo.update).not.toHaveBeenCalled();

    await service.update(FILE_ID, { name: 'villain.png' }, ALICE);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'file.update',
        changes: { before: { name: 'hero.png' }, after: { name: 'villain.png' } },
      }),
      'tx',
    );
  });

  it('pending 不能改名或刪除 → FILE_NOT_FOUND', async () => {
    const { service } = setup({ file: fileRow() });
    await expectAppError(service.update(FILE_ID, { name: 'x.png' }, ALICE), 'FILE_NOT_FOUND');
    await expectAppError(service.remove(FILE_ID, ALICE), 'FILE_NOT_FOUND');
  });

  it('刪除：交易內軟刪除＋稽核，交易後才刪物件', async () => {
    const { service, repo, storage, audit } = setup({ file: ready() });
    await service.remove(FILE_ID, ALICE);
    expect(repo.softDelete).toHaveBeenCalledWith(
      FILE_ID,
      { actorId: ALICE.id, deletionId: expect.any(String) },
      'tx',
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'file.delete' }),
      'tx',
    );
    expect(storage.delete).toHaveBeenCalledWith(storageKeyOf(FILE_ID));
    expect(repo.softDelete.mock.invocationCallOrder[0]).toBeLessThan(
      storage.delete.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('物件刪除失敗不影響刪除結果（留下孤兒物件）', async () => {
    const { service, storage } = setup({ file: ready() });
    storage.delete.mockRejectedValueOnce(new AppException('FILE_STORAGE_UNAVAILABLE'));
    await expect(service.remove(FILE_ID, ALICE)).resolves.toBeUndefined();
  });
});

describe('FileService：分塊上傳（docs/architecture/backend/09-file.md §5.2）', () => {
  const big = {
    name: 'level.pak',
    contentType: 'application/octet-stream',
    size: 20 * 1024 * 1024,
  };

  it('超過門檻 → 開 multipart upload、回切法而不是單次 PUT', async () => {
    const { service, repo, storage } = setup();
    const result = await service.createUpload(big, ALICE);
    expect(storage.createMultipartUpload).toHaveBeenCalled();
    expect(storage.presignUpload).not.toHaveBeenCalled();
    expect(repo.create.mock.calls[0]?.[0]).toMatchObject({ uploadId: 'upload-1' });
    expect(result).toMatchObject({
      upload: null,
      multipart: { partSize: PART_SIZE, partCount: 3 },
      thumbnailUpload: null,
    });
  });

  it('門檻以下 → 單次 PUT，不開 multipart', async () => {
    const { service, storage } = setup();
    const result = await service.createUpload({ ...big, size: THRESHOLD }, ALICE);
    expect(storage.createMultipartUpload).not.toHaveBeenCalled();
    expect(result.multipart).toBeNull();
    expect(result.upload).not.toBeNull();
  });

  it('parts：發出各塊網址；超出塊數 → FILE_UPLOAD_PART_INVALID', async () => {
    const { service, storage } = setup({
      file: fileRow({ uploadId: 'upload-1', size: big.size }),
    });
    const result = await service.createUploadParts(FILE_ID, { partNumbers: [1, 3] }, ALICE);
    expect(result.parts.map((part) => part.partNumber)).toEqual([1, 3]);
    expect(storage.presignUploadPart).toHaveBeenCalledWith(
      storageKeyOf(FILE_ID),
      'upload-1',
      3,
      expect.anything(),
    );
    await expectAppError(
      service.createUploadParts(FILE_ID, { partNumbers: [4] }, ALICE),
      'FILE_UPLOAD_PART_INVALID',
    );
  });

  it('parts：單次 PUT 的上傳 → FILE_UPLOAD_PART_INVALID；別人的 → FILE_NOT_FOUND', async () => {
    const { service } = setup({ file: fileRow() });
    await expectAppError(
      service.createUploadParts(FILE_ID, { partNumbers: [1] }, ALICE),
      'FILE_UPLOAD_PART_INVALID',
    );
    await expectAppError(
      service.createUploadParts(FILE_ID, { partNumbers: [1] }, BOB),
      'FILE_NOT_FOUND',
    );
  });

  it('complete：依塊號排序後組合，再確認大小', async () => {
    const { service, storage, repo } = setup({
      file: fileRow({ uploadId: 'upload-1', size: 30 }),
      head: { size: 30, etag: 'abc-2', contentType: 'application/octet-stream' },
    });
    await service.completeUpload(
      FILE_ID,
      {
        parts: [
          { partNumber: 2, etag: 'b' },
          { partNumber: 1, etag: 'a' },
        ],
      },
      ALICE,
    );
    expect(storage.completeMultipartUpload).toHaveBeenCalledWith(
      storageKeyOf(FILE_ID),
      'upload-1',
      [
        { partNumber: 1, etag: 'a' },
        { partNumber: 2, etag: 'b' },
      ],
    );
    expect(repo.markReady).toHaveBeenCalled();
  });

  it('complete：物件儲存已經組好（NoSuchUpload）、紀錄仍是 pending → 照常完成', async () => {
    const { service, storage, repo } = setup({
      file: fileRow({ uploadId: 'upload-1', size: 20 * 1024 * 1024 }),
      head: { size: 20 * 1024 * 1024, etag: 'abc-3', contentType: 'image/png' },
    });
    storage.completeMultipartUpload.mockRejectedValueOnce(
      new AppException('FILE_UPLOAD_INCOMPLETE'),
    );
    await service.completeUpload(FILE_ID, { parts: [{ partNumber: 1, etag: 'a' }] }, ALICE);
    expect(repo.markReady).toHaveBeenCalled();
  });

  it('complete：塊不對、物件也不在 → FILE_UPLOAD_INCOMPLETE', async () => {
    const { service, storage, repo } = setup({
      file: fileRow({ uploadId: 'upload-1', size: 20 * 1024 * 1024 }),
    });
    storage.completeMultipartUpload.mockRejectedValueOnce(
      new AppException('FILE_UPLOAD_INCOMPLETE'),
    );
    await expectAppError(
      service.completeUpload(FILE_ID, { parts: [{ partNumber: 1, etag: 'a' }] }, ALICE),
      'FILE_UPLOAD_INCOMPLETE',
    );
    expect(repo.markReady).not.toHaveBeenCalled();
  });

  it('complete：分塊上傳沒帶 parts → FILE_UPLOAD_PART_INVALID', async () => {
    const { service } = setup({ file: fileRow({ uploadId: 'upload-1' }) });
    await expectAppError(service.completeUpload(FILE_ID, {}, ALICE), 'FILE_UPLOAD_PART_INVALID');
  });

  it('abort：清掉分塊、內容與縮圖，紀錄軟刪除；不寫稽核、不發推播', async () => {
    const { service, storage, repo, audit, events } = setup({
      file: fileRow({ uploadId: 'upload-1' }),
    });
    await service.abortUpload(FILE_ID, ALICE);
    expect(repo.discardPending).toHaveBeenCalledWith(FILE_ID, ALICE.id);
    expect(storage.abortMultipartUpload).toHaveBeenCalledWith(storageKeyOf(FILE_ID), 'upload-1');
    expect(storage.delete).toHaveBeenCalledWith(thumbnailKeyOf(FILE_ID));
    expect(audit.record).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('abort：已完成 → FILE_ALREADY_UPLOADED；並行 complete 搶先 → FILE_ALREADY_UPLOADED', async () => {
    const done = setup({ file: fileRow({ status: 'ready', etag: 'a', uploadedAt: new Date() }) });
    await expectAppError(done.service.abortUpload(FILE_ID, ALICE), 'FILE_ALREADY_UPLOADED');

    const raced = setup({ file: fileRow() });
    raced.repo.discardPending.mockResolvedValueOnce(undefined as never);
    await expectAppError(raced.service.abortUpload(FILE_ID, ALICE), 'FILE_ALREADY_UPLOADED');
    expect(raced.storage.delete).not.toHaveBeenCalled();
  });
});

describe('FileService：縮圖', () => {
  it('登記時帶 thumbnail → 發縮圖的直傳網址', async () => {
    const { service, storage } = setup();
    const result = await service.createUpload(
      {
        name: 'a.png',
        contentType: 'image/png',
        size: 10,
        thumbnail: { contentType: 'image/webp', size: 100 },
      },
      ALICE,
    );
    expect(storage.presignUpload).toHaveBeenCalledWith(thumbnailKeyOf(result.file.id), {
      contentType: 'image/webp',
      expiresIn: 900,
    });
    expect(result.thumbnailUpload).not.toBeNull();
  });

  it('complete：縮圖存在且合規格才標記 hasThumbnail；不合規格不讓上傳失敗', async () => {
    const head = { size: 10, etag: 'abc', contentType: 'image/png' };
    const ok = setup({
      file: fileRow(),
      head,
      thumbnailHead: { size: 100, etag: 't', contentType: 'image/webp' },
    });
    await ok.service.completeUpload(FILE_ID, {}, ALICE);
    expect(ok.repo.markReady).toHaveBeenCalledWith(
      FILE_ID,
      expect.objectContaining({ hasThumbnail: true }),
      'tx',
    );

    const bad = setup({
      file: fileRow(),
      head,
      thumbnailHead: { size: 100, etag: 't', contentType: 'text/html' },
    });
    await bad.service.completeUpload(FILE_ID, {}, ALICE);
    expect(bad.repo.markReady).toHaveBeenCalledWith(
      FILE_ID,
      expect.objectContaining({ hasThumbnail: false }),
      'tx',
    );
  });

  it('有縮圖的檔案帶 thumbnailUrl，刪除時一併刪縮圖', async () => {
    const { service, storage } = setup({
      file: fileRow({ status: 'ready', etag: 'a', uploadedAt: new Date(), hasThumbnail: true }),
    });
    const file = await service.findOne(FILE_ID, BOB);
    expect(file.thumbnailUrl).toContain(thumbnailKeyOf(FILE_ID));
    await service.remove(FILE_ID, ALICE);
    expect(storage.delete).toHaveBeenCalledWith(thumbnailKeyOf(FILE_ID));
  });
});

describe('FileService：影像變體（docs/architecture/backend/09-file.md §5.4）', () => {
  const head = { size: 10, etag: 'abc', contentType: 'image/png' };

  it('complete：伺服器能處理的圖片 → 變體 pending，交易後排入產生；create 推播交給變體產生', async () => {
    const { service, repo, images, events } = setup({ file: fileRow(), head });
    await service.completeUpload(FILE_ID, {}, ALICE);
    expect(repo.markReady).toHaveBeenCalledWith(
      FILE_ID,
      expect.objectContaining({ variantStatus: 'pending' }),
      'tx',
    );
    expect(images.schedule).toHaveBeenCalledWith(FILE_ID, { announce: { folderId: null } });
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('complete：其他型別（含 SVG）→ 變體 none，不排入', async () => {
    const { service, repo, images } = setup({
      file: fileRow({ name: 'a.svg', contentType: 'image/svg+xml' }),
      head: { ...head, contentType: 'image/svg+xml' },
    });
    await service.completeUpload(FILE_ID, {}, ALICE);
    expect(repo.markReady).toHaveBeenCalledWith(
      FILE_ID,
      expect.objectContaining({ variantStatus: 'none' }),
      'tx',
    );
    expect(images.schedule).not.toHaveBeenCalled();
  });

  it('變體已產生 → image 帶三個版本，thumbnailUrl 優先用伺服器的圖示預覽', async () => {
    const { service } = setup({
      file: fileRow({
        status: 'ready',
        etag: 'a',
        uploadedAt: new Date(),
        hasThumbnail: true,
        variantStatus: 'ready',
        imageWidth: 800,
        imageHeight: 600,
        variantFormat: 'jpeg',
      }),
    });
    const file = await service.findOne(FILE_ID, BOB);
    expect(file.image).toMatchObject({ width: 800, height: 600 });
    expect(file.image?.previewUrl).toContain('/image/preview');
    expect(file.thumbnailUrl).toContain('/image/thumbnail');
    // 影像網址比 presigned 網址早失效 → urlExpiresAt 取較早的
    expect(file.urlExpiresAt).toBe('2026-09-27T00:10:00.000Z');
  });

  it('變體還沒產生 → image 為 null，thumbnailUrl 退回瀏覽器縮圖', async () => {
    const { service } = setup({
      file: fileRow({
        status: 'ready',
        etag: 'a',
        uploadedAt: new Date(),
        hasThumbnail: true,
        variantStatus: 'pending',
      }),
    });
    const file = await service.findOne(FILE_ID, BOB);
    expect(file.image).toBeNull();
    expect(file.thumbnailUrl).toContain(thumbnailKeyOf(FILE_ID));
  });

  it('刪除時一併刪除變體；沒有變體的檔案不必列物件', async () => {
    const withVariants = setup({
      file: fileRow({
        status: 'ready',
        etag: 'a',
        uploadedAt: new Date(),
        variantStatus: 'failed',
      }),
    });
    await withVariants.service.remove(FILE_ID, ALICE);
    expect(withVariants.storage.listObjects).toHaveBeenCalledWith(variantPrefixOf(FILE_ID));
    expect(withVariants.storage.delete).toHaveBeenCalledWith(
      `${variantPrefixOf(FILE_ID)}preview.jpeg`,
    );

    const plain = setup({ file: fileRow({ status: 'ready', etag: 'a', uploadedAt: new Date() }) });
    await plain.service.remove(FILE_ID, ALICE);
    expect(plain.storage.listObjects).not.toHaveBeenCalled();
  });
});

describe('FileService.update：樂觀鎖', () => {
  const ready = () => fileRow({ status: 'ready', etag: 'abc', uploadedAt: new Date(), version: 3 });

  it('帶的版本與目前不同 → FILE_VERSION_CONFLICT（details.current），不寫入', async () => {
    const { service, repo } = setup({ file: ready() });
    const error = await expectAppError(
      service.update(FILE_ID, { name: 'x.png', version: 2 }, ALICE),
      'FILE_VERSION_CONFLICT',
    );
    expect(error.details).toEqual({ current: 3 });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('讀到之後被別人搶先改名（UPDATE 沒命中）→ FILE_VERSION_CONFLICT，details.current 是重讀的版本', async () => {
    const { service, repo } = setup({ file: ready() });
    repo.update.mockResolvedValueOnce(undefined as never);
    const error = await expectAppError(
      service.update(FILE_ID, { name: 'x.png', version: 3 }, ALICE),
      'FILE_VERSION_CONFLICT',
    );
    expect(error.details).toEqual({ current: 4 });
    expect(repo.update).toHaveBeenCalledWith(FILE_ID, expect.anything(), 3, 'tx');
    expect(repo.findVersion).toHaveBeenCalledWith(FILE_ID, 'tx');
  });

  it('UPDATE 沒命中而重讀時已被刪除 → FILE_NOT_FOUND', async () => {
    const { service, repo } = setup({ file: ready() });
    repo.update.mockResolvedValueOnce(undefined as never);
    repo.findVersion.mockResolvedValueOnce(undefined);
    await expectAppError(
      service.update(FILE_ID, { name: 'x.png', version: 3 }, ALICE),
      'FILE_NOT_FOUND',
    );
  });
});

describe('FileService.list：keyset 游標', () => {
  const query = {
    offset: 0,
    limit: 2,
    sort: [{ sort: 'name' as const, order: 'asc' as const }],
  };
  const rows = [
    fileRow({ id: '44444444-4444-4444-8444-444444444444', name: 'a', status: 'ready' }),
    fileRow({ id: '55555555-5555-4555-8555-555555555555', name: 'b', status: 'ready' }),
  ];

  it('滿頁 → nextCursor 指向最後一筆；帶回游標時交給 repository', async () => {
    const { service, repo } = setup();
    repo.list.mockResolvedValue({ items: rows, total: 5, lastCreatedAt: undefined });
    const page = await service.list(query, ALICE);
    const cursor = decodeFileCursor(page.nextCursor ?? '');
    expect(cursor).toEqual({ sort: query.sort[0], value: 'b', id: rows[1]?.id });

    await service.list({ ...query, cursor: page.nextCursor ?? '' }, ALICE);
    expect(repo.list).toHaveBeenLastCalledWith(expect.anything(), cursor, undefined);
  });

  it('帶游標的頁不計總數：pagination.total 為 null', async () => {
    const { service, repo } = setup();
    repo.list.mockResolvedValue({ items: rows, total: 5, lastCreatedAt: undefined });
    const first = await service.list(query, ALICE);
    expect(first.pagination.total).toBe(5);
    repo.list.mockResolvedValue({ items: rows, total: null, lastCreatedAt: undefined });
    const next = await service.list({ ...query, cursor: first.nextCursor ?? '' }, ALICE);
    expect(next.pagination).toEqual({ offset: 0, limit: 2, total: null });
  });

  it('不滿一頁 → nextCursor 為 null', async () => {
    const { service, repo } = setup();
    repo.list.mockResolvedValue({ items: rows.slice(0, 1), total: 1, lastCreatedAt: undefined });
    await expect(service.list(query, ALICE)).resolves.toMatchObject({ nextCursor: null });
  });

  it('游標格式錯誤或排序與游標不一致 → VALIDATION_FAILED', async () => {
    const { service } = setup();
    await expectAppError(service.list({ ...query, cursor: 'garbage' }, ALICE), 'VALIDATION_FAILED');
    const other = encodeFileCursor({
      sort: { sort: 'size', order: 'desc' },
      value: 1,
      id: FILE_ID,
    });
    await expectAppError(service.list({ ...query, cursor: other }, ALICE), 'VALIDATION_FAILED');
  });
});

describe('FileService 的資料夾層級授權（docs/rbac/07-resource-grants.md §4、§5.2）', () => {
  const FOLDER = '66666666-6666-4666-8666-666666666666';
  const OTHER = '77777777-7777-4777-8777-777777777777';
  const nodes = () => [
    { id: FOLDER, parentId: null, inheritGrants: true, createdBy: BOB.id },
    { id: OTHER, parentId: null, inheritGrants: true, createdBy: BOB.id },
  ];
  const contributor = {
    global: [],
    nodes,
    grants: [{ resourceId: FOLDER, level: 'contributor' as const }],
  };

  it('列表：沒有全域 file:read → 只查看得到的資料夾；指定鎖住的資料夾 → AUTHZ_FORBIDDEN', async () => {
    const { service, repo } = setup({ access: contributor });
    repo.list.mockResolvedValue({ items: [], total: 0, lastCreatedAt: undefined });
    const query = {
      offset: 0,
      limit: 20,
      sort: [{ sort: 'createdAt' as const, order: 'desc' as const }],
    };

    await service.list(query, ALICE);
    expect(repo.list).toHaveBeenLastCalledWith(expect.anything(), undefined, {
      folderIds: [FOLDER],
    });
    await expectAppError(service.list({ ...query, folderId: OTHER }, ALICE), 'AUTHZ_FORBIDDEN');
  });

  it('看不到所在資料夾的 ready 檔案 → FILE_NOT_FOUND', async () => {
    const { service } = setup({
      access: contributor,
      file: fileRow({ status: 'ready', etag: 'e', uploadedAt: new Date(), folderId: OTHER }),
    });
    await expectAppError(service.findOne(FILE_ID, ALICE), 'FILE_NOT_FOUND');
  });

  it('擁有者規則：contributor 能改名自己上傳的，不能改名別人的（AUTHZ_FORBIDDEN）', async () => {
    const ready = { status: 'ready' as const, etag: 'e', uploadedAt: new Date(), folderId: FOLDER };
    const mine = setup({ access: contributor, file: fileRow({ ...ready, createdBy: ALICE.id }) });
    await mine.service.update(FILE_ID, { name: 'new.png' }, ALICE);
    expect(mine.repo.update).toHaveBeenCalled();

    const theirs = setup({ access: contributor, file: fileRow({ ...ready, createdBy: BOB.id }) });
    await expectAppError(
      theirs.service.update(FILE_ID, { name: 'x.png' }, ALICE),
      'AUTHZ_FORBIDDEN',
    );
    await expectAppError(theirs.service.remove(FILE_ID, ALICE), 'AUTHZ_FORBIDDEN');
    expect(theirs.repo.softDelete).not.toHaveBeenCalled();
  });

  it('capabilities 反映位置與擁有者', async () => {
    const ready = { status: 'ready' as const, etag: 'e', uploadedAt: new Date(), folderId: FOLDER };
    const { service } = setup({
      access: contributor,
      file: fileRow({ ...ready, createdBy: BOB.id }),
    });
    await expect(service.findOne(FILE_ID, ALICE)).resolves.toMatchObject({
      capabilities: { canUpdate: false, canDelete: false },
    });
  });

  it('上傳：沒有 create 的位置 → AUTHZ_FORBIDDEN；根目錄只看全域權限', async () => {
    const viewer = setup({
      access: { global: [], nodes, grants: [{ resourceId: FOLDER, level: 'viewer' }] },
    });
    const dto = { name: 'a.png', contentType: 'image/png', size: 10 };
    await expectAppError(
      viewer.service.createUpload({ ...dto, folderId: FOLDER }, ALICE),
      'AUTHZ_FORBIDDEN',
    );
    await expectAppError(
      viewer.service.createUpload({ ...dto, folderId: null }, ALICE),
      'AUTHZ_FORBIDDEN',
    );
    expect(viewer.repo.create).not.toHaveBeenCalled();
  });
});

describe('FileService.restore（docs/architecture/backend/13-trash.md §7.2、ADR-0025 D5）', () => {
  const FOLDER = '66666666-6666-4666-8666-666666666666';
  const deleted = (overrides: Partial<FileWithUploader> = {}) =>
    fileRow({
      status: 'ready',
      etag: 'e',
      uploadedAt: new Date(),
      deletedAt: new Date('2026-09-28T00:00:00Z'),
      deletionId: '99999999-9999-4999-8999-999999999999',
      ...overrides,
    });
  const present = { size: 10, etag: 'e', contentType: 'image/png' };

  it('沒有被刪除 → FILE_NOT_DELETED；不存在或是放棄的上傳 → FILE_NOT_FOUND', async () => {
    const live = setup({ file: fileRow({ status: 'ready', etag: 'e', uploadedAt: new Date() }) });
    await expectAppError(live.service.restore(FILE_ID, ALICE), 'FILE_NOT_DELETED');
    await expectAppError(setup().service.restore(FILE_ID, ALICE), 'FILE_NOT_FOUND');
    const abandoned = setup({ deleted: deleted({ status: 'pending' }) });
    await expectAppError(abandoned.service.restore(FILE_ID, ALICE), 'FILE_NOT_FOUND');
  });

  it('所在的資料夾已刪除 → FILE_RESTORE_CONFLICT（parentDeleted，帶上層）', async () => {
    const { service, repo } = setup({ deleted: deleted({ folderId: FOLDER }), head: present });
    const error = await expectAppError(service.restore(FILE_ID, ALICE), 'FILE_RESTORE_CONFLICT');
    expect(error.details).toEqual({
      reason: 'parentDeleted',
      parentType: 'fileFolder',
      parentId: FOLDER,
    });
    expect(repo.restore).not.toHaveBeenCalled();
  });

  it('原檔已不在物件儲存 → FILE_RESTORE_CONFLICT（objectMissing），不寫入', async () => {
    const { service, repo } = setup({ deleted: deleted() });
    const error = await expectAppError(service.restore(FILE_ID, ALICE), 'FILE_RESTORE_CONFLICT');
    expect(error.details).toEqual({ reason: 'objectMissing' });
    expect(repo.restore).not.toHaveBeenCalled();
  });

  it('成功：同一批的 deletion_id 為條件還原、稽核 file.restore、推 create；縮圖與變體不在時修正紀錄並重新產生', async () => {
    const row = deleted({ hasThumbnail: true, variantStatus: 'ready', variantFormat: 'jpeg' });
    const { service, repo, audit, events, images, storage } = setup({
      deleted: row,
      head: present,
    });
    storage.head.mockImplementation(async (key: string) =>
      key === storageKeyOf(FILE_ID) ? present : undefined,
    );
    repo.findById.mockResolvedValue(
      fileRow({ status: 'ready', etag: 'e', uploadedAt: new Date() }),
    );
    await service.restore(FILE_ID, ALICE);

    expect(repo.restore).toHaveBeenCalledWith(
      [FILE_ID],
      { actorId: ALICE.id, deletionId: row.deletionId },
      'tx',
    );
    expect(repo.clearThumbnail).toHaveBeenCalledWith([FILE_ID], 'tx');
    expect(repo.resetVariants).toHaveBeenCalledWith([FILE_ID], 'tx');
    expect(storage.head).toHaveBeenCalledWith(variantKeyOf(FILE_ID, 'thumbnail', 'jpeg'));
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'file.restore', resourceId: FILE_ID }),
      'tx',
    );
    expect(images.schedule).toHaveBeenCalledWith(FILE_ID);
    expect(events.publish).toHaveBeenCalledWith(
      'resource.changed',
      expect.objectContaining({
        changes: [expect.objectContaining({ resource: 'file', kind: 'create', id: FILE_ID })],
      }),
    );
  });

  it('被別人搶先還原（UPDATE 沒命中）→ FILE_NOT_DELETED', async () => {
    const { service, repo } = setup({ deleted: deleted(), head: present });
    repo.restore.mockResolvedValue([]);
    await expectAppError(service.restore(FILE_ID, ALICE), 'FILE_NOT_DELETED');
  });

  it('權限與刪除相同：contributor 能還原自己上傳的、不能還原別人的（AUTHZ_FORBIDDEN）；看不到資料夾 → 404', async () => {
    const nodes = () => [{ id: FOLDER, parentId: null, inheritGrants: true, createdBy: null }];
    const contributor = {
      global: [],
      nodes,
      grants: [{ resourceId: FOLDER, level: 'contributor' as const }],
    };
    const mine = setup({
      access: contributor,
      deleted: deleted({ folderId: FOLDER, createdBy: ALICE.id }),
      head: present,
    });
    mine.repo.findById.mockResolvedValue(
      fileRow({ status: 'ready', etag: 'e', uploadedAt: new Date(), folderId: FOLDER }),
    );
    await mine.service.restore(FILE_ID, ALICE);
    expect(mine.repo.restore).toHaveBeenCalled();

    const theirs = setup({
      access: contributor,
      deleted: deleted({ folderId: FOLDER, createdBy: BOB.id }),
      head: present,
    });
    await expectAppError(theirs.service.restore(FILE_ID, ALICE), 'AUTHZ_FORBIDDEN');
    expect(theirs.repo.restore).not.toHaveBeenCalled();

    const locked = setup({
      access: { global: [], nodes },
      deleted: deleted({ folderId: FOLDER, createdBy: ALICE.id }),
      head: present,
    });
    await expectAppError(locked.service.restore(FILE_ID, ALICE), 'FILE_NOT_FOUND');
  });
});
