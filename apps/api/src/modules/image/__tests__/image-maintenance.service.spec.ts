import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type { Env } from '@/core/config';
import type { Database } from '@/core/database';
import type { JobQueue } from '@/core/jobs';
import type { ListedObject, ObjectStorage } from '@/core/storage';
import type { ImageAssetRow } from '@/db/schema';
import type { TrashService } from '@/modules/trash/trash.service';

import type { ImageAssetRepository } from '../image-asset.repository';
import { ImageMaintenanceService } from '../image-maintenance.service';
import { IMAGE_PROCESS_JOB } from '../image-process.job';

const NOW = new Date('2026-10-09T12:00:00Z');
const OLD = new Date('2026-10-01T00:00:00Z');
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ORPHAN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function row(id: string, overrides: Partial<ImageAssetRow> = {}): ImageAssetRow {
  return { id, rev: 1, variantRev: 1, staleRevsPurgeAfter: null, ...overrides } as ImageAssetRow;
}

function setup(objects: Array<Pick<ListedObject, 'key'> & { lastModified?: Date }>) {
  const listed = objects.map((object) => ({ size: 1, lastModified: OLD, ...object }));
  const storage = {
    listObjects: vi.fn(async function* (prefix: string) {
      for (const object of listed) if (object.key.startsWith(prefix)) yield object;
    }),
    delete: vi.fn(async () => undefined),
  };
  const repo = {
    findUnclaimed: vi.fn(async (): Promise<ImageAssetRow[]> => []),
    findDetached: vi.fn(async (): Promise<ImageAssetRow[]> => []),
    findStaleRevs: vi.fn(async (): Promise<ImageAssetRow[]> => []),
    findStuck: vi.fn(async (): Promise<ImageAssetRow[]> => []),
    clearStaleRevs: vi.fn(async () => undefined),
    markQueued: vi.fn(async () => undefined),
    deleteRows: vi.fn(async (ids: readonly string[]) => [...ids]),
    existingIds: vi.fn(
      async (ids: readonly string[]) => new Set(ids.filter((id) => id !== ORPHAN)),
    ),
  };
  const jobs = { register: vi.fn(), enqueue: vi.fn(async () => undefined) };
  const trash = { retentionDays: vi.fn(async () => 30) };
  const db = { transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn('tx')) };
  const service = new ImageMaintenanceService(
    db as unknown as Database,
    repo as unknown as ImageAssetRepository,
    storage as unknown as ObjectStorage,
    jobs as unknown as JobQueue,
    trash as unknown as TrashService,
    { get: () => '' } as unknown as ConfigService<Env, true>,
  );
  return { service, repo, storage, jobs };
}

describe('ImageMaintenanceService（image.maintenance，docs/architecture/backend/25-image.md §15.6）', () => {
  it('沒被認領超過 24 小時、被換掉超過回收桶的保留期限 → 刪物件再刪紀錄', async () => {
    const ctx = setup([{ key: `images/${A}/master.jpg` }, { key: `images/${A}/r1/sm.jpg` }]);
    ctx.repo.findUnclaimed.mockResolvedValueOnce([row(A)]);
    ctx.repo.findDetached.mockResolvedValueOnce([row(B)]);
    const report = await ctx.service.sweep(NOW);

    expect(ctx.repo.findUnclaimed).toHaveBeenCalledWith(new Date('2026-10-08T12:00:00Z'), 200);
    expect(ctx.repo.findDetached).toHaveBeenCalledWith(new Date('2026-09-09T12:00:00Z'), 200);
    expect(ctx.storage.delete).toHaveBeenCalledWith(`images/${A}/master.jpg`);
    expect(ctx.storage.delete).toHaveBeenCalledWith(`images/${A}/r1/sm.jpg`);
    expect(ctx.repo.deleteRows).toHaveBeenCalledWith([A], 'tx');
    expect(ctx.repo.deleteRows).toHaveBeenCalledWith([B], 'tx');
    expect(report).toMatchObject({ unclaimed: 1, detached: 1, failures: 0 });
  });

  it('物件刪不掉 → 不刪紀錄（下一輪再試），記為失敗', async () => {
    const ctx = setup([{ key: `images/${A}/master.jpg` }]);
    ctx.repo.findUnclaimed.mockResolvedValueOnce([row(A)]);
    ctx.storage.delete.mockRejectedValueOnce(new Error('down'));
    const report = await ctx.service.sweep(NOW);
    expect(ctx.repo.deleteRows).toHaveBeenCalledWith([], 'tx');
    expect(report.failures).toBe(1);
  });

  it('舊版本：只刪不是目前版本、也不是還在處理的版本', async () => {
    const purgeAfter = new Date('2026-10-09T11:00:00Z');
    const ctx = setup([
      { key: `images/${A}/master.jpg` },
      { key: `images/${A}/r1/sm.jpg` },
      { key: `images/${A}/r2/sm.jpg` },
      { key: `images/${A}/r3/sm.jpg` },
    ]);
    ctx.repo.findStaleRevs.mockResolvedValueOnce([
      row(A, { rev: 3, variantRev: 2, staleRevsPurgeAfter: purgeAfter }),
    ]);
    const report = await ctx.service.sweep(NOW);
    expect(ctx.storage.delete).toHaveBeenCalledTimes(1);
    expect(ctx.storage.delete).toHaveBeenCalledWith(`images/${A}/r1/sm.jpg`);
    expect(ctx.repo.clearStaleRevs).toHaveBeenCalledWith(A, purgeAfter);
    expect(report.staleRevs).toBe(1);
  });

  it('卡住的處理 → 重新排入', async () => {
    const ctx = setup([]);
    ctx.repo.findStuck.mockResolvedValueOnce([row(A)]);
    const report = await ctx.service.sweep(NOW);
    expect(ctx.repo.findStuck).toHaveBeenCalledWith(new Date('2026-10-09T11:30:00Z'), 200);
    expect(ctx.jobs.enqueue).toHaveBeenCalledWith(IMAGE_PROCESS_JOB, { assetId: A });
    expect(report.requeued).toBe(1);
  });

  it('殘留物件：查不到資產、而且夠舊的才刪', async () => {
    const ctx = setup([
      { key: `images/${A}/master.jpg` },
      { key: `images/${ORPHAN}/upload` },
      { key: `images/${ORPHAN}/master.jpg`, lastModified: NOW },
      { key: 'images/not-a-uuid/x' },
    ]);
    const report = await ctx.service.sweep(NOW);
    expect(ctx.storage.delete).toHaveBeenCalledTimes(1);
    expect(ctx.storage.delete).toHaveBeenCalledWith(`images/${ORPHAN}/upload`);
    expect(report.orphanObjects).toBe(1);
  });
});
