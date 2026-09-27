import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type { Env } from '@/core/config';
import type { ObjectStorage } from '@/core/storage';

import type { FileImageService } from '../file-image.service';
import { FileMaintenanceService } from '../file-maintenance.service';
import { storageKeyOf, thumbnailKeyOf, variantKeyOf } from '../file.constants';
import type { FileRepository } from '../file.repository';

const NOW = new Date('2026-09-27T12:00:00Z');
const OLD = new Date('2026-09-25T00:00:00Z');
const RECENT = new Date('2026-09-27T11:59:00Z');
const PENDING_TTL = 86_400;

const LIVE = '11111111-1111-4111-8111-111111111111';
const STALE = '22222222-2222-4222-8222-222222222222';
const GONE = '33333333-3333-4333-8333-333333333333';
const FRESH = '44444444-4444-4444-8444-444444444444';

function setup() {
  const liveIds = new Set([LIVE, STALE, FRESH]);
  const repo = {
    findStalePending: vi.fn(async (_before: Date, afterId: string | undefined) =>
      afterId ? [] : [{ id: STALE, storageKey: storageKeyOf(STALE), uploadId: 'upload-stale' }],
    ),
    discardPending: vi.fn(async (id: string) => {
      liveIds.delete(id);
      return { id };
    }),
    findLiveIds: vi.fn(async (ids: string[]) => new Set(ids.filter((id) => liveIds.has(id)))),
    findLiveUploadIds: vi.fn(
      async (uploadIds: string[]) =>
        new Set(uploadIds.filter((uploadId) => uploadId === 'upload-live')),
    ),
    findPendingVariants: vi.fn(async () => [LIVE]),
  };
  const objects = [
    { key: storageKeyOf(LIVE), lastModified: OLD },
    { key: storageKeyOf(GONE), lastModified: OLD },
    { key: thumbnailKeyOf(GONE), lastModified: OLD },
    { key: variantKeyOf(GONE, 'preview', 'jpeg'), lastModified: OLD },
    // 剛寫入的物件：紀錄可能還沒提交，不能當孤兒
    { key: storageKeyOf('55555555-5555-4555-8555-555555555555'), lastModified: RECENT },
    // 不是檔案模組產生的 key：不碰
    { key: 'files/readme.txt', lastModified: OLD },
  ];
  const uploads = [
    { key: storageKeyOf(LIVE), uploadId: 'upload-live', initiatedAt: OLD },
    { key: storageKeyOf(GONE), uploadId: 'upload-orphan', initiatedAt: OLD },
    { key: storageKeyOf(FRESH), uploadId: 'upload-fresh', initiatedAt: RECENT },
  ];
  const storage = {
    delete: vi.fn(async () => undefined),
    abortMultipartUpload: vi.fn(async () => undefined),
    async *listObjects(prefix: string) {
      for (const object of objects) {
        if (object.key.startsWith(prefix)) yield { ...object, size: 1 };
      }
    },
    async *listMultipartUploads(prefix: string) {
      for (const upload of uploads) if (upload.key.startsWith(prefix)) yield upload;
    },
  };
  const images = { schedule: vi.fn() };
  const config = {
    get: vi.fn(
      (key: keyof Env) =>
        ({
          FILE_MAINTENANCE_INTERVAL: 3600,
          FILE_PENDING_TTL: PENDING_TTL,
          FILE_MAINTENANCE_DRY_RUN: false,
          NODE_ENV: 'test',
        })[key as string],
    ),
  };
  const service = new FileMaintenanceService(
    repo as unknown as FileRepository,
    storage as unknown as ObjectStorage,
    images as unknown as FileImageService,
    config as unknown as ConfigService<Env, true>,
  );
  return { service, repo, storage, images };
}

describe('FileMaintenanceService（docs/architecture/backend/09-file.md §9）', () => {
  it('偵測並清除四類殘留', async () => {
    const { service, repo, storage, images } = setup();
    const report = await service.sweep({ now: NOW });

    expect(report).toEqual({
      dryRun: false,
      stalePendingFiles: 1,
      orphanMultipartUploads: 1,
      // GONE 的原檔、縮圖、變體 ＋ 剛被清掉的 STALE 沒有物件
      orphanObjects: 3,
      requeuedVariants: 1,
      failures: 0,
    });
    expect(repo.findStalePending).toHaveBeenCalledWith(
      new Date(NOW.getTime() - PENDING_TTL * 1000),
      undefined,
      expect.any(Number),
    );
    // 逾時的上傳：紀錄軟刪除（系統，沒有操作者）、放棄分塊、刪內容與縮圖
    expect(repo.discardPending).toHaveBeenCalledWith(STALE, null);
    expect(storage.abortMultipartUpload).toHaveBeenCalledWith(storageKeyOf(STALE), 'upload-stale');
    expect(storage.delete).toHaveBeenCalledWith(storageKeyOf(STALE));
    expect(storage.delete).toHaveBeenCalledWith(thumbnailKeyOf(STALE));
    // 沒有紀錄的分塊上傳；剛開始的不碰
    expect(storage.abortMultipartUpload).toHaveBeenCalledWith(storageKeyOf(GONE), 'upload-orphan');
    expect(storage.abortMultipartUpload).not.toHaveBeenCalledWith(
      storageKeyOf(FRESH),
      'upload-fresh',
    );
    // 孤兒物件；活著的、剛寫入的、不認得的 key 不碰
    expect(storage.delete).toHaveBeenCalledWith(storageKeyOf(GONE));
    expect(storage.delete).toHaveBeenCalledWith(thumbnailKeyOf(GONE));
    expect(storage.delete).toHaveBeenCalledWith(variantKeyOf(GONE, 'preview', 'jpeg'));
    expect(storage.delete).not.toHaveBeenCalledWith(storageKeyOf(LIVE));
    expect(storage.delete).not.toHaveBeenCalledWith('files/readme.txt');
    // 卡住的變體重新排入
    expect(images.schedule).toHaveBeenCalledWith(LIVE);
  });

  it('dryRun：只偵測、不刪除任何東西', async () => {
    const { service, repo, storage, images } = setup();
    const report = await service.sweep({ now: NOW, dryRun: true });

    expect(report).toMatchObject({
      dryRun: true,
      stalePendingFiles: 1,
      orphanMultipartUploads: 1,
      orphanObjects: 3,
      requeuedVariants: 1,
    });
    expect(repo.discardPending).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
    expect(storage.abortMultipartUpload).not.toHaveBeenCalled();
    expect(images.schedule).not.toHaveBeenCalled();
  });

  it('與使用者的 complete 並行、紀錄已經 ready → 不刪內容', async () => {
    const { service, repo, storage } = setup();
    repo.discardPending.mockResolvedValueOnce(undefined as never);
    await service.sweep({ now: NOW });
    expect(storage.delete).not.toHaveBeenCalledWith(storageKeyOf(STALE));
  });

  it('物件刪除失敗只計入 failures，不中斷其他清理', async () => {
    const { service, storage } = setup();
    storage.delete.mockRejectedValueOnce(new Error('boom'));
    const report = await service.sweep({ now: NOW });
    expect(report.failures).toBe(1);
    expect(storage.delete).toHaveBeenCalledWith(variantKeyOf(GONE, 'preview', 'jpeg'));
  });

  it('一個步驟失敗（例：儲存服務不支援列出分塊上傳）不影響其他步驟', async () => {
    const { service, storage, images } = setup();
    storage.listMultipartUploads = async function* () {
      yield* [];
      throw new Error('NotImplemented');
    };
    const report = await service.sweep({ now: NOW });
    expect(report).toMatchObject({ stalePendingFiles: 1, orphanObjects: 3, failures: 1 });
    expect(images.schedule).toHaveBeenCalledWith(LIVE);
  });

  it('上一輪還沒結束時不重疊執行', async () => {
    const { service, repo } = setup();
    const [a, b] = await Promise.all([service.sweep({ now: NOW }), service.sweep({ now: NOW })]);
    expect(a).toBe(b);
    expect(repo.findPendingVariants).toHaveBeenCalledTimes(1);
  });
});
