import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type { Env } from '@/core/config';
import type { Database } from '@/core/database';
import type { JobQueue } from '@/core/jobs';
import type { CdnPurger, ObjectStorage } from '@/core/storage';
import { StorageSizeSources } from '@/core/usage';

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
/** 紀錄已軟刪除（在回收桶裡）：物件要留到永久刪除。 */
const TRASHED = '66666666-6666-4666-8666-666666666666';
/** `SUM(size)` 的結果。 */
const ACTUAL_USED = 1000;
/** 一小時前對帳過、計數一致：這一輪不必加總。 */
const USAGE_UP_TO_DATE = {
  usedBytes: ACTUAL_USED,
  reconciledAt: new Date('2026-09-27T11:00:00Z'),
};

function setup(usage: { usedBytes: number; reconciledAt: Date | null } = USAGE_UP_TO_DATE) {
  const liveIds = new Set([LIVE, STALE, FRESH]);
  const deletedIds = new Set([TRASHED]);
  const repo = {
    findStalePending: vi.fn(async (_before: Date, afterId: string | undefined) =>
      afterId ? [] : [{ id: STALE, storageKey: storageKeyOf(STALE), uploadId: 'upload-stale' }],
    ),
    discardPending: vi.fn(async (id: string) => {
      liveIds.delete(id);
      return { id };
    }),
    // 有紀錄（含已軟刪除）的 id：已刪除紀錄的物件留給 trash.purge（docs/architecture/backend/14-revisions.md §9 R4a）
    findRecordedIds: vi.fn(
      async (ids: string[]) => new Set(ids.filter((id) => liveIds.has(id) || deletedIds.has(id))),
    ),
    findLiveUploadIds: vi.fn(
      async (uploadIds: string[]) =>
        new Set(uploadIds.filter((uploadId) => uploadId === 'upload-live')),
    ),
    findPendingVariants: vi.fn(async () => [LIVE]),
    // 已用量的計數與實際的合計（docs/architecture/05-tenancy.md §13.3 D8）
    lockStorageUsage: vi.fn(async (_tx: unknown) => usage),
    sumSizes: vi.fn(async (_tx: unknown) => ACTUAL_USED),
    setStorageUsage: vi.fn(async (_used: number, _at: Date, _tx: unknown) => undefined),
  };
  // withTransaction(db, fn) 只呼叫 db.transaction(fn)
  const db = { transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn('tx')) };
  const objects = [
    { key: storageKeyOf(LIVE), lastModified: OLD },
    { key: storageKeyOf(GONE), lastModified: OLD },
    { key: thumbnailKeyOf(GONE), lastModified: OLD },
    { key: variantKeyOf(GONE, 'preview', 'jpeg'), lastModified: OLD },
    // 紀錄在回收桶裡：不是孤兒
    { key: storageKeyOf(TRASHED), lastModified: OLD },
    { key: thumbnailKeyOf(TRASHED), lastModified: OLD },
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
  const images = { enqueueVariants: vi.fn(async () => undefined) };
  const config = {
    get: vi.fn(
      (key: keyof Env) =>
        ({
          FILE_MAINTENANCE_CRON: '0 * * * *',
          FILE_PENDING_TTL: PENDING_TTL,
          FILE_MAINTENANCE_DRY_RUN: false,
        })[key as string],
    ),
  };
  const jobs = { register: vi.fn() };
  const sizeSources = new StorageSizeSources();
  const cdn = { schedule: vi.fn(async (_keys: readonly string[]) => undefined) };
  const service = new FileMaintenanceService(
    db as unknown as Database,
    repo as unknown as FileRepository,
    storage as unknown as ObjectStorage,
    images as unknown as FileImageService,
    jobs as unknown as JobQueue,
    sizeSources,
    config as unknown as ConfigService<Env, true>,
    cdn as unknown as CdnPurger,
  );
  return { service, repo, storage, images, jobs, sizeSources, cdn };
}

describe('FileMaintenanceService（docs/architecture/backend/09-file.md §9）', () => {
  it('以 FILE_MAINTENANCE_CRON 註冊成排程工作', () => {
    const { service, jobs } = setup();
    service.onModuleInit();
    expect(jobs.register).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'file.maintenance' }),
      expect.any(Function),
      { cron: '0 * * * *' },
    );
  });

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
      // 一小時前才對帳過
      storageUsageDrift: null,
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
    // 紀錄在回收桶裡（已軟刪除）的物件留給 trash.purge（docs/architecture/backend/14-revisions.md §9 R4a）
    expect(storage.delete).not.toHaveBeenCalledWith(storageKeyOf(TRASHED));
    expect(storage.delete).not.toHaveBeenCalledWith(thumbnailKeyOf(TRASHED));
    // 卡住的變體重新排入
    expect(images.enqueueVariants).toHaveBeenCalledWith(LIVE);
  });

  it('刪掉的孤兒變體排入邊緣快取的清理；原檔與縮圖不走 CDN，不排（docs/architecture/backend/09-file.md §16.6）', async () => {
    const { service, cdn } = setup();
    await service.sweep({ now: NOW });
    const scheduled = cdn.schedule.mock.calls.flatMap(([keys]) => keys);
    expect(scheduled).toEqual([variantKeyOf(GONE, 'preview', 'jpeg')]);
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
    expect(images.enqueueVariants).not.toHaveBeenCalled();
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
    expect(images.enqueueVariants).toHaveBeenCalledWith(LIVE);
  });

  describe('已用量的對帳（docs/architecture/05-tenancy.md §13.3 D8）', () => {
    it('距上次對帳超過一天：鎖住計數後以 SUM(size) 重算、寫回，偏差記進報告', async () => {
      const { service, repo } = setup({
        usedBytes: ACTUAL_USED + 30,
        reconciledAt: new Date('2026-09-26T11:00:00Z'),
      });
      const report = await service.sweep({ now: NOW });
      expect(report.storageUsageDrift).toBe(30);
      expect(repo.lockStorageUsage).toHaveBeenCalledWith('tx');
      expect(repo.sumSizes).toHaveBeenCalledWith('tx');
      expect(repo.setStorageUsage).toHaveBeenCalledWith(ACTUAL_USED, NOW, 'tx');
    });

    it('從沒對帳過（migration 剛回填）→ 這一輪就對帳；一致時偏差是 0，仍記下對帳時間', async () => {
      const { service, repo } = setup({ usedBytes: ACTUAL_USED, reconciledAt: null });
      const report = await service.sweep({ now: NOW });
      expect(report.storageUsageDrift).toBe(0);
      expect(repo.setStorageUsage).toHaveBeenCalledWith(ACTUAL_USED, NOW, 'tx');
    });

    it('距上次對帳不到一天 → 不加總、不寫回', async () => {
      const { service, repo } = setup();
      const report = await service.sweep({ now: NOW });
      expect(report.storageUsageDrift).toBeNull();
      expect(repo.sumSizes).not.toHaveBeenCalled();
      expect(repo.setStorageUsage).not.toHaveBeenCalled();
    });

    it('dry run：只偵測偏差，不修正計數', async () => {
      const { service, repo } = setup({ usedBytes: 0, reconciledAt: null });
      const report = await service.sweep({ now: NOW, dryRun: true });
      expect(report.storageUsageDrift).toBe(-ACTUAL_USED);
      expect(repo.setStorageUsage).not.toHaveBeenCalled();
    });

    it('其他擁有者登記的容量合計（圖片資產）一併計入（docs/architecture/backend/25-image.md §15.2 D3）', async () => {
      const { service, repo, sizeSources } = setup({ usedBytes: ACTUAL_USED, reconciledAt: null });
      sizeSources.register('image', async () => 500);
      const report = await service.sweep({ now: NOW });
      expect(report.storageUsageDrift).toBe(-500);
      expect(repo.setStorageUsage).toHaveBeenCalledWith(ACTUAL_USED + 500, NOW, 'tx');
    });

    it('計數那一列不見了 → 視為從沒對帳過，補上那一列', async () => {
      const { service, repo } = setup();
      repo.lockStorageUsage.mockResolvedValueOnce(undefined as never);
      const report = await service.sweep({ now: NOW });
      expect(report.storageUsageDrift).toBe(-ACTUAL_USED);
      expect(repo.setStorageUsage).toHaveBeenCalledWith(ACTUAL_USED, NOW, 'tx');
    });
  });

  it('上一輪還沒結束時不重疊執行', async () => {
    const { service, repo } = setup();
    const [a, b] = await Promise.all([service.sweep({ now: NOW }), service.sweep({ now: NOW })]);
    expect(a).toBe(b);
    expect(repo.findPendingVariants).toHaveBeenCalledTimes(1);
  });
});
