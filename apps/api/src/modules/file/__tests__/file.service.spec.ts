import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import type { Env } from '@/core/config';
import type { Database } from '@/core/database';
import { AppException } from '@/core/errors';
import type { DomainEventBus } from '@/core/events';
import type { ObjectStorage, StoredObjectHead } from '@/core/storage';
import type { AuditService } from '@/modules/audit-log/audit.service';

import { storageKeyOf } from '../file.constants';
import type { FileRepository, FileWithUploader } from '../file.repository';
import { FileService } from '../file.service';

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
const MAX_SIZE = 1000;

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
    createdAt: now,
    createdBy: ALICE.id,
    updatedAt: now,
    updatedBy: ALICE.id,
    deletedAt: null,
    uploader: { id: ALICE.id, displayName: 'Alice' },
    ...overrides,
  };
}

function setup(options: { file?: FileWithUploader; head?: StoredObjectHead } = {}) {
  const repo = {
    findById: vi.fn(async () => options.file),
    create: vi.fn(async (values: Partial<FileWithUploader>) => fileRow(values)),
    markReady: vi.fn(async () => fileRow({ status: 'ready' })),
    update: vi.fn(async () => fileRow({ status: 'ready' })),
    softDelete: vi.fn(async () => fileRow({ status: 'ready' })),
    list: vi.fn(),
  };
  const storage = {
    ensureBucket: vi.fn(async () => undefined),
    head: vi.fn(async () => options.head),
    delete: vi.fn(async () => undefined),
    presignUpload: vi.fn(async (key: string) => ({
      url: `http://storage/${key}?put`,
      method: 'PUT' as const,
      headers: { 'Content-Type': 'image/png' },
      expiresAt: new Date('2026-09-27T00:15:00Z'),
    })),
    presignDownload: vi.fn(async (key: string, opts: { disposition: string }) => ({
      url: `http://storage/${key}?${opts.disposition}`,
      method: 'GET' as const,
      headers: {},
      expiresAt: new Date('2026-09-27T00:15:00Z'),
    })),
  };
  const audit = { record: vi.fn(async () => undefined) };
  const events = { publish: vi.fn() };
  // withTransaction(db, fn) 只呼叫 db.transaction(fn)
  const db = { transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn('tx')) };
  const config = {
    get: vi.fn(
      (key: keyof Env) => ({ FILE_UPLOAD_MAX_SIZE: MAX_SIZE, FILE_URL_TTL: 900 })[key as string],
    ),
  };
  const service = new FileService(
    db as unknown as Database,
    repo as unknown as FileRepository,
    storage as unknown as ObjectStorage,
    audit as unknown as AuditService,
    events as unknown as DomainEventBus,
    config as unknown as ConfigService<Env, true>,
  );
  return { service, repo, storage, audit, events };
}

async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AppException);
  expect((error as AppException).code).toBe(code);
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
  it('物件存在且大小相符 → ready、寫稽核、發事件', async () => {
    const { service, repo, audit, events } = setup({
      file: fileRow(),
      head: { size: 10, etag: 'abc', contentType: 'image/png' },
    });
    await service.completeUpload(FILE_ID, ALICE);

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
      changes: [{ resource: 'file', kind: 'create', id: FILE_ID }],
    });
  });

  it('物件還不存在 → FILE_UPLOAD_INCOMPLETE', async () => {
    const { service } = setup({ file: fileRow() });
    await expectAppError(service.completeUpload(FILE_ID, ALICE), 'FILE_UPLOAD_INCOMPLETE');
  });

  it('大小不符 → 刪掉物件並回 FILE_SIZE_MISMATCH', async () => {
    const { service, storage, repo } = setup({
      file: fileRow(),
      head: { size: 999, etag: 'abc', contentType: 'image/png' },
    });
    await expectAppError(service.completeUpload(FILE_ID, ALICE), 'FILE_SIZE_MISMATCH');
    expect(storage.delete).toHaveBeenCalledWith(storageKeyOf(FILE_ID));
    expect(repo.markReady).not.toHaveBeenCalled();
  });

  it('已經 ready → FILE_ALREADY_UPLOADED', async () => {
    const { service } = setup({
      file: fileRow({ status: 'ready', etag: 'abc', uploadedAt: new Date() }),
    });
    await expectAppError(service.completeUpload(FILE_ID, ALICE), 'FILE_ALREADY_UPLOADED');
  });

  it('並行完成時第二個請求 → FILE_ALREADY_UPLOADED', async () => {
    const { service, repo } = setup({
      file: fileRow(),
      head: { size: 10, etag: 'abc', contentType: 'image/png' },
    });
    repo.markReady.mockResolvedValueOnce(undefined as never);
    await expectAppError(service.completeUpload(FILE_ID, ALICE), 'FILE_ALREADY_UPLOADED');
  });

  it('別人的 pending 上傳視為不存在 → FILE_NOT_FOUND', async () => {
    const { service } = setup({ file: fileRow() });
    await expectAppError(service.completeUpload(FILE_ID, BOB), 'FILE_NOT_FOUND');
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
    expect(repo.softDelete).toHaveBeenCalledWith(FILE_ID, ALICE.id, 'tx');
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
