import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Tenancy, TenantContext } from '@/core/tenant';
import type { StorageCapacity, StorageTotalRepository, TenantStorageUsage } from '@/core/usage';
import { STORAGE_TOTAL_STALE_AFTER_MS } from '@/core/usage';
import type { PlatformNotificationService } from '@/modules/platform-notification/platform-notification.service';

import { crossedStorageTotalRatio, StorageTotalService } from '../storage-total.service';

const NOW = new Date('2026-10-09T12:00:00.000Z');

interface Setup {
  limitBytes: number;
  before: number;
  after: number;
  /** 進入每個租戶時回報的已用量；拋錯代表那個租戶失敗。 */
  tenants?: Array<{ id: string; used: number | Error }>;
}

function setup({ limitBytes, before, after, tenants = [] }: Setup) {
  let current: { id: string; used: number | Error } | undefined;
  const tenancy = {
    forEachActive: vi.fn(async (fn: (tenant: TenantContext) => Promise<void>) => {
      const failed: string[] = [];
      for (const tenant of tenants) {
        current = tenant;
        try {
          // oxlint-disable-next-line no-await-in-loop -- 模擬依序進入租戶
          await fn({ id: tenant.id } as TenantContext);
        } catch {
          failed.push(tenant.id);
        }
      }
      return failed;
    }),
  };
  const storageUsage = {
    used: vi.fn(async () => {
      if (current?.used instanceof Error) throw current.used;
      return current?.used ?? 0;
    }),
  };
  const repo = {
    total: vi
      .fn()
      .mockResolvedValueOnce({ usedBytes: before, measuredAt: NOW })
      .mockResolvedValue({ usedBytes: after, measuredAt: NOW }),
    save: vi.fn(async () => undefined),
  };
  const capacity = { limitBytes, invalidate: vi.fn() };
  const notifications = { notifyHolders: vi.fn(async () => undefined) };
  const service = new StorageTotalService(
    tenancy as unknown as Tenancy,
    storageUsage as unknown as TenantStorageUsage,
    repo as unknown as StorageTotalRepository,
    capacity as unknown as StorageCapacity,
    notifications as unknown as PlatformNotificationService,
  );
  return { service, repo, capacity, notifications };
}

describe('crossedStorageTotalRatio', () => {
  it.each([
    { before: 0.5, after: 0.79, expected: undefined },
    { before: 0.5, after: 0.8, expected: 0.8 },
    { before: 0.85, after: 0.9, expected: undefined },
    { before: 0.85, after: 1, expected: 1 },
    { before: 0.5, after: 1.2, expected: 1 },
    { before: 1.1, after: 1.2, expected: undefined },
    { before: 0.9, after: 0.5, expected: undefined },
  ])('$before → $after：$expected', ({ before, after, expected }) => {
    expect(crossedStorageTotalRatio(before, after)).toBe(expected);
  });
});

describe('StorageTotalService（儲存的止水線，docs/architecture/backend/25-image.md §12 D8）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('逐一寫入每個租戶的已用量；失敗的租戶不寫（保留上一次的值）並回報；最後讓快取失效', async () => {
    const { service, repo, capacity } = setup({
      limitBytes: 0,
      before: 0,
      after: 300,
      tenants: [
        { id: 't1', used: 100 },
        { id: 't2', used: new Error('db down') },
        { id: 't3', used: 200 },
      ],
    });

    await expect(service.rollup()).resolves.toEqual({ failed: ['t2'], usedBytes: 300 });
    expect(repo.save.mock.calls).toEqual([
      ['t1', 100, NOW],
      ['t3', 200, NOW],
    ]);
    expect(capacity.invalidate).toHaveBeenCalledOnce();
  });

  it('越過 80% 時通知能改租戶的平台管理者，連到租戶清單', async () => {
    const { service, notifications } = setup({ limitBytes: 1000, before: 700, after: 850 });
    await service.rollup();
    expect(notifications.notifyHolders).toHaveBeenCalledWith('tenant:update', {
      type: 'storage.totalNearLimit',
      params: { percent: 85 },
      link: { route: 'tenant.list', params: {} },
    });
  });

  it('停在門檻以上、沒有啟用止水線：不通知', async () => {
    const above = setup({ limitBytes: 1000, before: 850, after: 900 });
    await above.service.rollup();
    expect(above.notifications.notifyHolders).not.toHaveBeenCalled();
    const disabled = setup({ limitBytes: 0, before: 0, after: 10 ** 12 });
    await disabled.service.rollup();
    expect(disabled.notifications.notifyHolders).not.toHaveBeenCalled();
  });

  it('摘要：使用率、警示比例；沒有啟用時上限與使用率是 null', async () => {
    const { service } = setup({ limitBytes: 1000, before: 250, after: 250 });
    await expect(service.summary()).resolves.toEqual({
      usedBytes: 250,
      limitBytes: 1000,
      usageRatio: 0.25,
      warningRatio: 0.8,
      measuredAt: NOW.toISOString(),
      isStale: false,
    });
    await expect(
      setup({ limitBytes: 0, before: 250, after: 250 }).service.summary(),
    ).resolves.toMatchObject({ limitBytes: null, usageRatio: null });
  });

  it('摘要：量測超過 1 小時或還沒量測過時標成過舊', async () => {
    const { service, repo } = setup({ limitBytes: 1000, before: 0, after: 0 });
    repo.total.mockReset();
    repo.total.mockResolvedValueOnce({
      usedBytes: 0,
      measuredAt: new Date(NOW.getTime() - STORAGE_TOTAL_STALE_AFTER_MS - 1),
    });
    await expect(service.summary()).resolves.toMatchObject({ isStale: true });
    repo.total.mockResolvedValueOnce({ usedBytes: 0, measuredAt: null });
    await expect(service.summary()).resolves.toMatchObject({ isStale: true, measuredAt: null });
  });
});
